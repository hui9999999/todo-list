export type Scope = "work" | "life" | "study" | "unassigned";
export type Status = "todo" | "doing" | "done" | "failed" | "cancelled";
export interface TaskFields {
  title: string;
  notes: string;
  scope: Scope;
  status: Status;
  priority: "high" | "mid" | "low";
  parent_id: string | null;
  project_id?: string | null;
  estimated_minutes?: number | null;
  due_date: string | null;
  due_at: string | null;
  due_timezone: string | null;
  fail_reason: string;
  hidden: boolean;
}
export interface Task extends TaskFields {
  id: string;
  version: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  legacy_period: string | null;
  workflow?: TaskWorkflow;
}
export interface WorkflowTask {
  id: string; title: string; status: Status; version: number; fail_reason: string; deleted: boolean;
}
export interface TaskWorkflow {
  blocking_dependencies: WorkflowTask[];
  active_children: WorkflowTask[];
  failed_children: WorkflowTask[];
}
export interface User {
  id: string;
  username?: string | null;
  is_admin?: boolean;
  email: string | null;
  phone?: string | null;
  nickname?: string | null;
  identifier?: string;
  timezone: string;
}
export interface AccountProfile {
  user: User;
  nickname_changes_remaining: number;
  nickname_reset_at: string;
}
export interface Plan {
  id: string;
  task_id: string;
  plan_date: string;
}
export interface TaskEvent {
  id: string;
  kind: string;
  actor: string;
  occurred_at: string;
  recorded_at: string;
  before: Task | null;
  after: Task;
}
export interface ImportPreview {
  id: string;
  count: number;
  children: number;
  confirmed: boolean;
  history_count: number;
  plan_count: number;
  issues: { row: number; message: string }[];
  warnings: string[];
  status_counts: Record<Status, number>;
  items: {
    legacy_id: string;
    legacy_parent_id: string | null;
    fields: TaskFields;
    completed_at?: string | null;
    legacy_period?: string | null;
  }[];
}
