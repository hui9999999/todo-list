from datetime import datetime, time, timezone, date
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from .auth import current_user
from .db import database
from .models import User, Task, TaskEvent, TaskSnapshot, OutboxEvent, DailyPlanItem, utcnow, uid
from .schemas import TaskFields, TaskUpdate, VersionRequest, PlanRequest
from .task_scope import infer_scope, with_inferred_scope

router = APIRouter()
TASK_COLUMNS = [c.name for c in Task.__table__.columns if c.name != 'user_id']
ACTIVE_STATUSES = ('todo', 'doing')
CLOSED_STATUSES = ('done', 'failed', 'cancelled')


def task_json(task: Task) -> dict:
    result = {}
    for key in TASK_COLUMNS:
        value = getattr(task, key)
        result[key] = value.isoformat() if hasattr(value, 'isoformat') else value
    return result


def workflow_context(db: Session, user: User):
    from .advanced_models import TaskDependency
    tasks = list(db.scalars(select(Task).where(Task.user_id == user.id)))
    children, dependencies = {}, {}
    for task in tasks:
        if task.parent_id:
            children.setdefault(task.parent_id, []).append(task)
    for edge in db.scalars(select(TaskDependency).where(TaskDependency.user_id == user.id)):
        dependencies.setdefault(edge.task_id, []).append(edge.depends_on_id)
    return {t.id: t for t in tasks}, children, dependencies


def task_workflow(task: Task, context):
    tasks, children, dependencies = context
    def summary(row):
        return {'id': row.id, 'title': row.title, 'status': row.status, 'version': row.version,
                'fail_reason': row.fail_reason, 'deleted': bool(row.deleted_at)}
    descendants, seen, stack = [], {task.id}, list(children.get(task.id, []))
    while stack:
        child = stack.pop()
        if child.id in seen or child.deleted_at:
            continue
        seen.add(child.id)
        descendants.append(child)
        stack.extend(children.get(child.id, []))
    blockers = [tasks[identifier] for identifier in dependencies.get(task.id, []) if identifier in tasks
                and (tasks[identifier].deleted_at or tasks[identifier].status not in ('done', 'cancelled'))]
    return {'blocking_dependencies': [summary(t) for t in blockers],
            'active_children': [summary(t) for t in descendants if t.status in ACTIVE_STATUSES],
            'failed_children': [summary(t) for t in descendants if t.status == 'failed']}


def task_view(db: Session, user: User, task: Task, context=None):
    # Derived data stays out of persisted snapshots and backups.
    return {**task_json(task), 'workflow': task_workflow(task, context or workflow_context(db, user))}


def record(db: Session, task: Task, kind: str, before: dict | None = None, occurred_at=None):
    db.flush()
    event = TaskEvent(user_id=task.user_id, task_id=task.id, kind=kind,
                      occurred_at=occurred_at or utcnow(), before_version=before['version'] if before else None,
                      after_version=task.version)
    db.add(event)
    db.flush()
    db.add(TaskSnapshot(user_id=task.user_id, event_id=event.id, before=before, after=task_json(task)))
    db.add(OutboxEvent(user_id=task.user_id, event_id=event.id, kind='task.' + kind))


def owned(db: Session, user: User, task_id: str, lock=False) -> Task:
    query = select(Task).where(Task.id == task_id, Task.user_id == user.id)
    task = db.scalar(query.with_for_update() if lock else query)
    if not task:
        raise HTTPException(404, '任务不存在')
    return task


def version_matches(task: Task, version: int):
    if task.version != version:
        raise HTTPException(409, {'message': '任务已被修改，请刷新后重试', 'current': task_json(task)})


def lock_user(db: Session, user: User):
    # One lock order for hierarchy edits prevents races and deadlocks.
    db.scalar(select(User).where(User.id == user.id).with_for_update())


def validate_tree(db: Session, user: User, body: TaskFields, task: Task | None = None, *, allow_failed_children=False):
    from .advanced_models import Project
    if body.status == 'failed' and not body.fail_reason.strip():
        raise HTTPException(422, '标记失败时请填写失败原因')
    if body.project_id:
        if not db.scalar(select(Project.id).where(Project.id == body.project_id, Project.user_id == user.id)):
            raise HTTPException(404, '项目不存在')
    if body.parent_id:
        parent = owned(db, user, body.parent_id)
        if parent.deleted_at:
            raise HTTPException(409, '不能关联垃圾站中的父任务')
        if parent.status in CLOSED_STATUSES and body.status in ACTIVE_STATUSES:
            raise HTTPException(409, '请先重新打开父任务，再添加或恢复未完成子任务')
        seen = {task.id} if task else set()
        while parent:
            if parent.id in seen:
                raise HTTPException(422, '父子任务不能形成循环')
            seen.add(parent.id)
            parent = owned(db, user, parent.parent_id) if parent.parent_id else None
    if task and (body.status in CLOSED_STATUSES or body.status == 'doing' and task.status != 'doing'):
        workflow = task_workflow(task, workflow_context(db, user))
        if body.status in ('done', 'doing') and workflow['blocking_dependencies']:
            first = workflow['blocking_dependencies'][0]
            reason = '已移入垃圾站，请恢复或解除依赖' if first['deleted'] else '失败，请重试或解除依赖' if first['status'] == 'failed' else '尚未完成'
            raise HTTPException(409, f'依赖任务“{first["title"]}”{reason}')
        if body.status in CLOSED_STATUSES and workflow['active_children']:
            raise HTTPException(409, '请先处理所有待办或进行中的子任务，再选择父任务结果')
        if body.status == 'done' and task.status != 'done' and workflow['failed_children']:
            expected = {t['id']: t['version'] for t in workflow['failed_children']}
            if not allow_failed_children and getattr(body, 'confirmed_failed_children', None) != expected:
                raise HTTPException(409, '子任务包含失败项，请查看最新结果并明确确认父任务整体目标已完成')


def add_default_today_plan(db: Session, user: User, task: Task):
    day = utcnow().astimezone(ZoneInfo(user.timezone)).date()
    due_day = task.due_date or (task.due_at.astimezone(ZoneInfo(user.timezone)).date() if task.due_at else None)
    # The whole 23:59 minute belongs to the account's current day.
    if task.deleted_at or due_day is None or due_day > day:
        return
    existing = db.scalar(select(DailyPlanItem).where(DailyPlanItem.user_id == user.id,
        DailyPlanItem.task_id == task.id, DailyPlanItem.plan_date == day))
    if not existing:
        db.add(DailyPlanItem(user_id=user.id, task_id=task.id, plan_date=day))
        db.flush()


def create_task(db: Session, user: User, body: TaskFields) -> Task:
    body = with_inferred_scope(body)
    validate_tree(db, user, body)
    values = body.model_dump()
    values['fail_reason'] = values['fail_reason'].strip() if body.status == 'failed' else ''
    if values['due_at']:
        values['due_at'] = values['due_at'].astimezone(timezone.utc)
    task = Task(user_id=user.id, **values, completed_at=utcnow() if body.status == 'done' else None)
    db.add(task)
    record(db, task, 'created')
    add_default_today_plan(db, user, task)
    return task


def with_default_deadline(body: TaskFields, user: User) -> TaskFields:
    # Explicit null means the user chose no deadline; omitted fields use today 23:59.
    if {'due_date', 'due_at'} & body.model_fields_set:
        return body
    zone = ZoneInfo(user.timezone)
    deadline = datetime.combine(utcnow().astimezone(zone).date(), time(23, 59), zone)
    return body.model_copy(update={'due_at': deadline.astimezone(timezone.utc), 'due_timezone': user.timezone})


@router.get('/tasks')
def list_tasks(trash: bool = False, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    query = select(Task).where(Task.user_id == user.id)
    query = query.where(Task.deleted_at.is_not(None) if trash else Task.deleted_at.is_(None))
    context = workflow_context(db, user)
    return [task_view(db, user, t, context) for t in db.scalars(query.order_by(Task.created_at, Task.id))]


@router.post('/tasks', status_code=201)
def add_task(body: TaskFields, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    lock_user(db, user)
    return task_view(db, user, create_task(db, user, with_default_deadline(body, user)))


@router.post('/tasks/classify')
def classify_task(body: TaskFields, user: User = Depends(current_user)):
    return {'scope': infer_scope(body.title, body.notes)}


@router.get('/tasks/{task_id}')
def get_task(task_id: str, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    return task_view(db, user, owned(db, user, task_id))


@router.put('/tasks/{task_id}')
def update_task(task_id: str, body: TaskUpdate, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    return edit_task(db, user, task_id, body)


def edit_task(db: Session, user: User, task_id: str, body: TaskUpdate, *, auto_plan: bool = True):
    lock_user(db, user)
    task = owned(db, user, task_id, True)
    version_matches(task, body.version)
    if task.deleted_at:
        raise HTTPException(409, '请先恢复任务')
    validate_tree(db, user, body, task)
    before = task_json(task)
    before_deadline = (task.due_date, task.due_at)
    for key, value in body.model_dump(exclude={'version', 'confirmed_failed_children'}).items():
        setattr(task, key, value.astimezone(timezone.utc) if key == 'due_at' and value else value)
    task.fail_reason = task.fail_reason.strip() if task.status == 'failed' else ''
    if before['status'] != task.status:
        task.completed_at = utcnow() if task.status == 'done' else None
    task.version += 1
    task.updated_at = utcnow()
    record(db, task, 'status_changed' if before['status'] != task.status else 'updated', before)
    if auto_plan and before_deadline != (task.due_date, task.due_at):
        add_default_today_plan(db, user, task)
    return task_view(db, user, task)


@router.post('/tasks/{task_id}/trash')
def trash_task(task_id: str, body: VersionRequest, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    lock_user(db, user)
    root = owned(db, user, task_id, True)
    version_matches(root, body.version)
    if root.deleted_at:
        raise HTTPException(409, '任务已在垃圾站')
    tasks = list(db.scalars(select(Task).where(Task.user_id == user.id, Task.deleted_at.is_(None))))
    ids = {root.id}
    while True:
        expanded = ids | {t.id for t in tasks if t.parent_id in ids}
        if expanded == ids:
            break
        ids = expanded
    group = uid()
    for task in tasks:
        if task.id in ids:
            before = task_json(task)
            task.deleted_at, task.deletion_group = utcnow(), group
            task.version += 1
            task.updated_at = utcnow()
            record(db, task, 'trashed', before)
    return {'count': len(ids)}


@router.post('/tasks/{task_id}/restore')
def restore_task(task_id: str, body: VersionRequest, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    lock_user(db, user)
    root = owned(db, user, task_id, True)
    version_matches(root, body.version)
    if not root.deleted_at:
        raise HTTPException(409, '任务已经恢复')
    tasks = list(db.scalars(select(Task).where(Task.user_id == user.id, Task.deletion_group == root.deletion_group)))
    ids = {t.id for t in tasks}
    for task in tasks:
        if task.parent_id and task.parent_id not in ids:
            parent = owned(db, user, task.parent_id)
            if parent.deleted_at or (parent.status in CLOSED_STATUSES and task.status in ACTIVE_STATUSES):
                raise HTTPException(409, '请先恢复或重新打开父任务')
    for task in tasks:
        before = task_json(task)
        task.deleted_at, task.deletion_group = None, None
        task.version += 1
        task.updated_at = utcnow()
        record(db, task, 'restored', before)
    return {'count': len(tasks)}


@router.get('/tasks/{task_id}/events')
def task_history(task_id: str, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    owned(db, user, task_id)
    rows = db.execute(select(TaskEvent, TaskSnapshot).join(TaskSnapshot, TaskSnapshot.event_id == TaskEvent.id)
        .where(TaskEvent.user_id == user.id, TaskEvent.task_id == task_id).order_by(TaskEvent.recorded_at, TaskEvent.id))
    return [{'id': e.id, 'kind': e.kind, 'actor': e.actor, 'occurred_at': e.occurred_at.isoformat(), 'recorded_at': e.recorded_at.isoformat(),
             'before_version': e.before_version, 'after_version': e.after_version, 'before': s.before, 'after': s.after} for e, s in rows]


@router.get('/daily-plans')
def list_plan(plan_date: date, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    return [{'id': p.id, 'task_id': p.task_id, 'plan_date': p.plan_date.isoformat()} for p in db.scalars(
        select(DailyPlanItem).join(Task, Task.id == DailyPlanItem.task_id).where(DailyPlanItem.user_id == user.id,
        DailyPlanItem.plan_date == plan_date, Task.deleted_at.is_(None)))]


@router.post('/daily-plans')
def add_plan(body: PlanRequest, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    lock_user(db, user)
    task = owned(db, user, body.task_id)
    if task.deleted_at:
        raise HTTPException(409, '请先恢复任务')
    existing = db.scalar(select(DailyPlanItem).where(DailyPlanItem.user_id == user.id,
        DailyPlanItem.task_id == task.id, DailyPlanItem.plan_date == body.plan_date))
    if not existing:
        db.add(DailyPlanItem(user_id=user.id, task_id=task.id, plan_date=body.plan_date))
    return {'message': '已加入安排'}


@router.delete('/daily-plans/{item_id}')
def remove_plan(item_id: str, user: User = Depends(current_user), db: Session = Depends(database, scope='function')):
    item = db.scalar(select(DailyPlanItem).where(DailyPlanItem.id == item_id, DailyPlanItem.user_id == user.id))
    if not item:
        raise HTTPException(404, '安排不存在')
    db.delete(item)
    return {'message': '已移出安排'}
