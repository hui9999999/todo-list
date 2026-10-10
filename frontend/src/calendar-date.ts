export type CalendarDateUnit='year'|'month'|'day';
function utcDate(year:number,month:number,day:number) {
  const date=new Date(0);date.setUTCHours(12,0,0,0);date.setUTCFullYear(year,month-1,day);return date;
}
export function calendarDateParts(value:string) {
  const [year,month,day]=value.split('-').map(Number);
  return {year:year!,month:month!,day:day!};
}
export function monthDays(year:number,month:number) {return utcDate(year,month+1,0).getUTCDate();}
export function shiftCalendarDate(value:string,unit:CalendarDateUnit,steps:number) {
  const {year,month,day}=calendarDateParts(value);
  const date=utcDate(year,month,unit==='day'?day:1);
  if(unit==='day')date.setUTCDate(day+steps);
  else {
    if(unit==='year')date.setUTCFullYear(year+steps);
    else date.setUTCMonth(month-1+steps);
    date.setUTCDate(Math.min(day,monthDays(date.getUTCFullYear(),date.getUTCMonth()+1)));
  }
  return date.getUTCFullYear()<1 || date.getUTCFullYear()>9999?value:date.toISOString().slice(0,10);
}
