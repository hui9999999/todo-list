"""Authenticated download cards generated from validated assistant requests."""
import json
from collections import Counter
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
from .auth import current_user
from .db import database
from .models import User, utcnow
from .advanced_models import RunEvent, PeriodReport
from .common import private_owned, today, tenant_session
from .assistant_schemas import ExportRequest
from .assistant_data import account_profile, MODELS, visible_statement, safe_record
from .period_reports import generate_report
from .reports import (report_filters, select_report, excel_report, word_report, pdf_report,
    csv_report, SCOPES, STATES, PRIORITIES)

router=APIRouter(prefix='/assistant')
FORMATS={'xlsx':(excel_report,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    'docx':(word_report,'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    'pdf':(pdf_report,'application/pdf'),'csv':(csv_report,'text/csv')}


def task_report(db,user,request):
    return select_report(db,user,report_filters(request.start,request.end,request.date_field,
        request.scope,request.status,request.include_trash,request.include_notes))


def period_document(row):
    data=row.content;summary=data['summary']
    lines=[f"完成任务 {summary['completed_tasks']} 项，完成事件 {summary['completion_events']} 次，新增任务 {summary['created_tasks']} 项，专注 {round(summary['focus_seconds']/60,1)} 分钟，活跃 {data['active_days']} 天。",
        *data['insights'],data['advice'],
        '完成清单按报告期内的真实事件计算；待结转清单为报告生成时快照。专注时长归于开始日期。']
    rows=[]
    for completed in data['completed']:
        rows.append({'id':completed['task_id'],'title':completed['title'],'scope':SCOPES.get(completed['scope'],'未分类'),
            'status':STATES['done'],'priority':PRIORITIES[completed['priority']],'completed_at':completed['occurred_at'],
            'notes':'期内完成事件 '+completed['event_id'],'due_date':None,'state_key':'done'})
    for pending in data['carryover']:
        rows.append({'id':pending['task_id'],'title':pending['title'],'scope':SCOPES.get(pending.get('scope'),'未记录分类'),
            'status':STATES.get(pending.get('status'),'未记录状态')+' · 待结转','state_key':pending.get('status'),
            'priority':PRIORITIES[pending['priority']],'notes':'报告生成时未完成的到期任务',
            'due_date':pending['due'],'completed_at':None})
    for item in rows:
        for key in ('project','parent_id','created_at','updated_at','due_at','estimated_minutes','fail_reason','hidden','trash'):
            item.setdefault(key,'')
    title='周报' if row.kind=='weekly' else '月报'
    scopes=Counter(item['scope'] for item in rows)
    return {'title':'小狒待办 · '+title,'description':f'{row.start} 至 {row.end}（'+('进行中的周期，统计截至生成时' if row.partial else '完整周期')+'）',
        'selection':'；'.join(lines),'timezone':row.timezone,'generated_at':row.generated_at.isoformat(),
        'include_notes':True,'rows':rows,'summary':{'total':len(rows),
        'scopes':{key:scopes[title] for key,title in SCOPES.items()},
        'states':{key:sum(item['state_key']==key for item in rows) for key in STATES}},
        'period_summary':summary,'daily':data['daily']}


def prepare_export(db,user,request:ExportRequest):
    record={'request':request.model_dump(mode='json')}
    if request.kind=='account':
        label='完整账号资料';description='账号、任务（含隐藏与垃圾站）、周期、日历、专注、对话、记忆、报告及偏好等；不含密码与登录密钥。'
        stem='xiaoqi-account-'+str(today(user))
    elif request.kind=='tasks':
        report=task_report(db,user,request)
        label='任务资料';description=f"{report['summary']['total']} 项；{report['description']}；{report['selection']}"
        stem='xiaoqi-tasks-'+str(today(user))
    else:
        report=generate_report(db,user,request.kind,request.date or today(user),'assistant')
        record['report_id']=report.id
        label='周报' if request.kind=='weekly' else '月报'
        description=f"{report.start} 至 {report.end}；完成 {report.content['summary']['completed_tasks']} 项；专注 {round(report.content['summary']['focus_seconds']/60,1)} 分钟"+('；当前周期尚未结束' if report.partial else '')
        stem='xiaoqi-'+request.kind+'-'+str(report.start)
    return {**record,'label':label,'description':description,'format':request.format,'filename':stem+'.'+request.format}


def public_download(event):
    return {'id':event.id,**{key:event.payload[key] for key in ('label','description','format','filename','message_id')}}


def conversation_downloads(db,user,conversation_id):
    from .advanced_models import AgentRun, Message, ForgetRequest
    # Forgotten conversations must not expose generated files while cleanup is pending.
    forgotten=db.scalar(select(Message.id).where(Message.user_id==user.id,Message.conversation_id==conversation_id,
        Message.id.in_(select(ForgetRequest.source_id).where(ForgetRequest.user_id==user.id))).limit(1))
    if forgotten:return []
    return [public_download(event) for event in db.scalars(select(RunEvent).join(AgentRun,
        (AgentRun.id==RunEvent.run_id)&(AgentRun.user_id==RunEvent.user_id)).where(RunEvent.user_id==user.id,
        AgentRun.conversation_id==conversation_id,RunEvent.kind=='export').order_by(RunEvent.sequence))]


def stream_account(user_id):
    # Stream complete rows rather than loading every conversation and image into memory.
    with tenant_session(user_id) as db:
        user=db.get(User,user_id)
        header={'schema_version':'assistant-account-1','account':account_profile(user),'exported_at':utcnow().isoformat(),
            'excluded':'密码、密码哈希、API密钥、登录/找回密码令牌、CSRF凭据、向量索引；已遗忘的来源及派生内容不恢复。'}
        yield json.dumps(header,ensure_ascii=False)[:-1]
        for name in MODELS:
            yield ','+json.dumps(name)+':['
            first=True
            for row in db.scalars(visible_statement(db,user,name).execution_options(yield_per=50)):
                if not first:yield ','
                yield json.dumps(safe_record(db,user,row,full=True),ensure_ascii=False,default=str)
                first=False
            yield ']'
        yield '}'


@router.get('/exports/{identifier}')
def download(identifier:str,user:User=Depends(current_user),db:Session=Depends(database,scope='function')):
    event=private_owned(db,RunEvent,user.id,identifier)
    if event.kind!='export':raise HTTPException(404,'导出记录不存在')
    from .advanced_models import AgentRun
    run=private_owned(db,AgentRun,user.id,event.run_id)
    if identifier not in {card['id'] for card in conversation_downloads(db,user,run.conversation_id)}:
        raise HTTPException(404,'导出记录已清理')
    request=ExportRequest.model_validate(event.payload['request'])
    if request.kind=='account':
        return StreamingResponse(stream_account(user.id),media_type='application/json',headers={
            'Content-Disposition':f'attachment; filename="{event.payload["filename"]}"','Cache-Control':'no-store'})
    else:
        report=task_report(db,user,request) if request.kind=='tasks' else period_document(private_owned(db,PeriodReport,user.id,event.payload['report_id']))
        if request.format in ('pdf','docx') and sum(sum(len(str(value)) for value in row.values()) for row in report['rows'])>2_000_000:
            raise HTTPException(422,'内容过多，请缩小导出范围或选择 Excel')
        generator,media=FORMATS[request.format];content=generator(report)
    return Response(content,media_type=media,headers={'Content-Disposition':f'attachment; filename="{event.payload["filename"]}"','Cache-Control':'no-store'})
