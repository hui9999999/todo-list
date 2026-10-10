import type {User} from './types';
export interface AdminUsage {
  calls:number; input_tokens:number; output_tokens:number; reported_tokens:number;
  pending_calls:number; unknown_calls:number; unreported_calls:number; unreported_reserved_tokens:number;
}
export interface AdminUser extends User {created_at:string; verified:boolean; usage:AdminUsage}
export interface AdminUsers {items:AdminUser[]; total:number; page:number; page_size:number; summary:AdminUsage & {total_users:number}}
export interface AdminUsageDetail {
  user:User & {created_at:string; verified:boolean}; summary:AdminUsage;
  models:(AdminUsage & {provider:string; model:string})[];
  daily:(AdminUsage & {date:string})[];
  period:{start:string; end:string};
  events:{id:string; provider:string; model:string; purpose:string; state:string; local_date:string; created_at:string; input_tokens:number|null; output_tokens:number|null; reserved_tokens:number}[];
}
export interface AdminPersona {content:string; default_content:string; version:number; updated_at:string; updated_by:string|null}
