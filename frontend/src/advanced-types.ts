export interface Settings {
  version: number; timezone: string; memory_enabled: boolean; followups_enabled: boolean;
  news_topics: string[]; news_enabled: boolean; suggestions_enabled: boolean; notifications_enabled: boolean;
  weather_enabled: boolean; weather_city: string; theme: 'light'|'dark'|'warm';
  work_start: string; work_end: string; recommendation_time: string;
  daily_capacity: number|null; daily_call_limit: number; daily_token_limit: number;
}
export interface Connection {
  id: string; name: string; provider: string; region: string; enabled: boolean; key_mask: string;
  workspace_id?: string|null; models?: {id:string;name:string;purpose?:string}[];
  capabilities: Record<string, {chat?: boolean; tools?: boolean; vision?: boolean; thinking?: string}>;
}
export interface Preference {connection_id: string; model: string; thinking: string}
export interface Action {kind: string; task_id?: string; version?: number; fields?: Partial<import('./types').TaskFields>; plan_date?: string; recurrence?: RecurrenceSettings | null; confirmed_failed_children?: Record<string, number> | null}
export interface Proposal {id: string; version: number; state: string; reason: string; actions: Action[]; before: (Partial<import('./types').Task> & Pick<import('./types').Task, 'id'|'title'|'status'|'version'>)[]; result: {kind?: string; task_id?: string; version?: number; recurrence?: {rule_id:string;version:number;instances:{id:string;task_id:string;version:number;created:boolean}[]}}[]; undone: boolean; expires_at: string}
export interface Run {id: string; status: string; answer: string; clarification: {question: string; options: string[]}|null; actual_mode?: string; mode_reason?: string; proposals?: Proposal[]; error?: string|null; created_at?: string; web_search?: {state:string;count?:number}|null}
export interface Conversation {id: string; title: string}
export interface ChatAttachment {name: string; size: number; media_type: string; pages?: number|null; truncated?: boolean; warnings?: string[]}
export interface AssistantDownload {id:string;message_id:string;label:string;description:string;format:string;filename:string}
export interface WebSource {index:number;title:string;url:string;site:string;snippet:string;published_at:string|null;kind?:'weather'}
export interface Message {id: string; role: string; content: string; attachments?: ChatAttachment[];downloads?:AssistantDownload[];web_sources?:WebSource[]}
export interface HistoryHit {event_id: string; task_id: string; title: string; kind: string; occurred_at: string; completed: boolean; reason: string; snapshot: {notes: string; status: string}}
export interface Memory {id: string; content: string; key: string; scope: string; kind: string; version: number; pinned: boolean; valid_to: string|null; effective_state: string; effective_strength: number; source_kind: string}
export interface NewsSource {title:string;url:string;site:string;published_at:string|null}
export interface Recommendation {id: string; kind: string; title: string; reason: string; topic?: string; url: string|null; source: string|null; published_at: string|null; state: string; bookmarked: boolean; proposal: Proposal|null;ai_curated?:boolean;summary?:string|null;points?:string[];sources?:NewsSource[]}
export interface Focus {id: string; task_id: string; state: string; duration_seconds: number; elapsed: number; server_now: string; version: number; started_at?: string}
export interface Rule {id: string; template: import('./types').TaskFields; frequency: string; interval: number; mode: string; next_date: string|null; enabled: boolean; version: number}
export interface RecurrenceSettings {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;
  mode: 'calendar' | 'after_completion';
  start_date: string;
}
export interface Job {id: string; kind: string; state: string; attempts: number; error: string|null}
export interface Usage {day: string; chat_calls: number; background_calls: number; background_tokens: number; call_limit: number; token_limit: number; note: string; events: {id: string; purpose: string; model: string; state: string; input_tokens: number|null; output_tokens: number|null}[]}
