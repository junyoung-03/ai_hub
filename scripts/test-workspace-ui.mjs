import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const output={};
runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/actions/schedule-model.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:output,Date,Intl});
const {dayInSeoul,weekEnd,actionGroup,actionDay,isOverdue,dDay,eventsFromDetail,eventOnDay,eventGroup,monthCells}=output;
const now=Date.parse('2026-10-08T12:00:00+09:00'), today='2026-10-08';
const action={status:'open',deadlineStatus:'confirmed',deadlineDate:'2026-10-09',deadlineAt:null};
const detail={item:{id:'i',title:'일정 자료',source:'calendar',contentText:'원문 근거'},calendar:null,eventObservations:[]};
test('Seoul day and week boundaries use Monday-Sunday including Sunday itself',()=>{
 assert.equal(dayInSeoul('2026-10-07T15:00:00Z'),today);
 assert.equal(weekEnd(today),'2026-10-11');assert.equal(weekEnd('2026-10-11'),'2026-10-11');assert.equal(weekEnd('2026-10-12'),'2026-10-18');
});
test('group past, this week, next week, later and unresolved without inventing dates',()=>{
 assert.equal(actionGroup({...action,deadlineDate:'2026-10-07'},today,now),'overdue');
 assert.equal(actionGroup(action,today,now),'week');assert.equal(actionGroup({...action,deadlineDate:'2026-10-12'},today,now),'next');
 assert.equal(actionGroup({...action,deadlineDate:'2026-10-19'},today,now),'later');
 assert.equal(actionGroup({...action,deadlineStatus:'needs_review'},today,now),'review');
 assert.equal(actionDay({...action,deadlineStatus:'none'}),'');
});
test('expired exact time is overdue even on D-day; completed is never overdue',()=>{
 const expired={...action,deadlineDate:null,deadlineAt:'2026-10-08T11:00:00+09:00'};
 assert.equal(isOverdue(expired,today,now),true);assert.equal(actionGroup(expired,today,now),'overdue');
 assert.equal(isOverdue({...expired,status:'completed'},today,now),false);
 assert.equal(dDay({...action,deadlineDate:'2026-10-07'},today),'D+1');assert.equal(dDay(expired,today),'D-day');
});
test('all-day Calendar end is exclusive and overlapping event stays this week',()=>{
 const events=eventsFromDetail({...detail,calendar:{status:'confirmed',start:{date:'2026-10-07'},end:{date:'2026-10-10'}}});
 assert.equal(events.length,1);assert.equal(events[0].kind,'calendar');assert.equal(events[0].lastDate,'2026-10-09');
 assert.equal(eventOnDay(events[0],today),true);assert.equal(eventOnDay(events[0],'2026-10-10'),false);assert.equal(eventGroup(events[0],today),'week');
});
test('timed Calendar ending exactly at Seoul midnight excludes following day',()=>{
 const events=eventsFromDetail({...detail,calendar:{status:'confirmed',start:{dateTime:'2026-10-08T23:00:00+09:00'},end:{dateTime:'2026-10-09T00:00:00+09:00'}}});
 assert.equal(events[0].date,today);assert.equal(events[0].lastDate,today);
});
test('cancelled Calendar event is omitted; independent AI observations remain events',()=>{
 const events=eventsFromDetail({...detail,calendar:{status:'cancelled',start:{date:today}},eventObservations:[{status:'needs_review',date:null,datetime:null,rawText:'10월',evidence:{text:'10월 행사'}},{status:'confirmed',date:today,datetime:null,rawText:today,evidence:{text:'2026-10-08 행사'}}]});
 assert.equal(events.length,1);assert.equal(events[0].kind,'observation');assert.equal(events[0].evidence,'2026-10-08 행사');assert.equal('actionId' in events[0],false);
});
test('monthly cells include leading/trailing days with complete calendar weeks',()=>{
 const cells=monthCells('2026-10');assert.equal(cells.length,35);assert.equal(cells[0],'2026-09-27');assert.equal(cells.at(-1),'2026-10-31');
 assert.equal(monthCells('2026-08').length,42);
});
