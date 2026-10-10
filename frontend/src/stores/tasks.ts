import { defineStore } from "pinia";
import { ref } from "vue";
import { api, post } from "../api";
import type { Task, TaskFields, Plan } from "../types";
import type { RecurrenceSettings, Rule } from '../advanced-types';
export function fieldsOf(task: Task): TaskFields {
  const {
    title,
    notes,
    scope,
    status,
    priority,
    parent_id,
    project_id,
    estimated_minutes,
    due_date,
    due_at,
    due_timezone,
    fail_reason,
    hidden,
  } = task;
  return {
    title,
    notes,
    scope,
    status,
    priority,
    parent_id,
    project_id,
    estimated_minutes,
    due_date,
    due_at,
    due_timezone,
    fail_reason,
    hidden,
  };
}
export function localDate(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export const useTasks = defineStore("tasks", () => {
  const items = ref<Task[]>([]),
    trash = ref<Task[]>([]),
    plans = ref<Plan[]>([]),
    loading = ref(false);
  let generation = 0;
  function clear() {
    generation++;
    items.value = [];
    trash.value = [];
    plans.value = [];
  }
  async function refresh(day: string) {
    loading.value = true;
    const ticket = ++generation;
    try {
      const [active, deleted, daily] = await Promise.all([
        api<Task[]>("/tasks"),
        api<Task[]>("/tasks?trash=true"),
        api<Plan[]>("/daily-plans?plan_date=" + day),
      ]);
      if (ticket === generation) {
        items.value = active;
        trash.value = deleted;
        plans.value = daily;
      }
    } finally {
      if (ticket === generation) loading.value = false;
    }
  }
  async function create(fields: TaskFields, automaticScope = false) {
    const {scope, ...automaticFields} = fields;
    return post<Task>("/tasks", automaticScope ? automaticFields : fields);
  }
  async function createRecurrence(fields: TaskFields, settings: RecurrenceSettings, automaticScope = false) {
    const template = { ...fields };
    if (automaticScope) {
      const result = await post<{scope:TaskFields['scope']}>('/tasks/classify', {title:fields.title, notes:fields.notes});
      template.scope = result.scope;
    }
    return post<Rule>('/recurrences', {template, ...settings});
  }
  async function update(task: Task, fields: TaskFields, confirmedFailedChildren?: Record<string, number>) {
    return api<Task>("/tasks/" + task.id, {
      method: "PUT",
      body: JSON.stringify({ ...fields, version: task.version, confirmed_failed_children: confirmedFailedChildren }),
    });
  }
  async function moveToTrash(task: Task) {
    return post("/tasks/" + task.id + "/trash", { version: task.version });
  }
  async function restore(task: Task) {
    return post("/tasks/" + task.id + "/restore", { version: task.version });
  }
  async function plan(task: Task, day: string) {
    return post("/daily-plans", { task_id: task.id, plan_date: day });
  }
  async function unplan(item: Plan) {
    return api("/daily-plans/" + item.id, { method: "DELETE" });
  }
  return {
    items,
    trash,
    plans,
    loading,
    refresh,
    create,
    createRecurrence,
    update,
    moveToTrash,
    restore,
    plan,
    unplan,
    clear,
  };
});
