export interface DailyStatistic {
  date: string;
  completed: number;
  created: number;
  focus_seconds: number;
}
export interface PeriodSummary {
  completed_tasks: number;
  completion_events: number;
  created_tasks: number;
  focus_seconds: number;
}
export interface CompletionRecord {
  event_id: string;
  task_id: string;
  title: string;
  occurred_at: string;
  date: string;
  scope: string;
  priority: string;
}
export interface Statistics {
  start: string;
  end: string;
  summary: PeriodSummary;
  previous: PeriodSummary & { start: string; end: string };
  daily: DailyStatistic[];
  states: Record<string, number>;
  scopes: Record<string, number>;
  completion_priorities: Record<string, number>;
  completed: CompletionRecord[];
}
export interface ChartSeries {
  label: string;
  color: string;
  values: number[];
}
