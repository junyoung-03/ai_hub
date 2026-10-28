import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { uiLoader } from './helpers/content-ui-loader.mjs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const load=uiLoader();

test('today search and suggested searches open library results',()=>{
 const routes=[];
 let stateIndex=0;
 const ui=uiLoader({
  react:{useState:initial=>[stateIndex++===0?'  계약 & 문서  ':initial,()=>{}]},
  'next/navigation':{useRouter:()=>({push:path=>routes.push(path)})},
  '@/components/actions/use-workspace-data':{useActions:()=>({rows:[]}),useScheduleItems:()=>({details:{}})},
  '@/components/actions/schedule-model':{eventsFromDetail:()=>[]},
  './today-calendar':{TodayCalendar:()=>null},
  './today-todo-list':{TodayTodoList:()=>null},
  './add-todo-modal':{AddTodoModal:()=>null},
 });
 const tree=ui('src/components/home/today-dashboard.tsx').TodayDashboard({today:'2026-10-28'});
 const find=(node,predicate)=>{
  if(!node||typeof node!=='object')return undefined;
  if(predicate(node))return node;
  for(const child of React.Children.toArray(node.props?.children)){const found=find(child,predicate);if(found)return found;}
 };
 find(tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
 find(tree,node=>node.type==='button'&&node.props.children==='회의').props.onClick();
 assert.deepEqual(routes,['/library?q='+encodeURIComponent('계약 & 문서'),'/library?q='+encodeURIComponent('회의')]);
});

test('library search renders the existing search workspace in library context',async()=>{
 let observed;
 const ui=uiLoader({
  '@/lib/supabase/auth':{requirePageUser:async()=>({id:'test-user'})},
  '@/components/shell/app-shell':{AppShell:({children})=>React.createElement('main',null,children)},
  '@/components/shell/page-heading':{PageHeading:({title})=>React.createElement('h1',null,title)},
  '@/components/workspace/request-clock':{getWorkspaceClock:async()=>123},
  '@/components/search/search-workspace':{SearchWorkspace:props=>{observed=props;return React.createElement('div',null,'Search results');}},
 });
 const {default:LibraryPage}=ui('src/app/library/page.tsx');
 const element=await LibraryPage({searchParams:Promise.resolve({q:'  synthetic query  '})});
 const html=renderToStaticMarkup(element);
 assert.match(html,/자료함 검색/);assert.match(html,/Search results/);
 assert.equal(observed.initialQuery,'synthetic query');assert.equal(observed.backHref,'/library');
});

test('library renders effective user classification and distinguishes unanalysed items',()=>{
 const {effectiveClassification}=load('src/lib/items/presentation.ts');
 const {LibraryList}=load('src/components/library/library-list.tsx');
 const base={id:'synthetic',title:'Synthetic document',source:'upload',format:'pdf',processingStatus:'completed',createdAt:'2026-10-13T00:00:00Z'};
 const classification=effectiveClassification({ai_primary_topic:'AI hidden topic',user_primary_topic:'User topic',ai_document_type:'notice',user_document_type:'schedule',ai_tags:['AI hidden tag'],user_tags:[]});
 const html=renderToStaticMarkup(React.createElement(LibraryList,{items:[{...base,classification}]}));
 assert.match(html,/User topic/);assert.match(html,/일정/);assert.match(html,/직접 수정/);
 assert.doesNotMatch(html,/AI hidden topic|AI hidden tag/);
 const pending=renderToStaticMarkup(React.createElement(LibraryList,{items:[{...base,processingStatus:'queued',classification:effectiveClassification(null)}]}));
 assert.doesNotMatch(pending,/AI 분류|직접 수정/);assert.match(pending,/분석 대기/);
});

test('classification filter form submits existing topic and documentType exactly once and preserves source',()=>{
 const {LibraryToolbar}=load('src/components/library/library-toolbar.tsx');
 const {parseItemQuery}=load('src/lib/items/filters.ts');
 const query=parseItemQuery(new URLSearchParams({source:'gmail',topic:'User topic',documentType:'notice'}));
 const html=renderToStaticMarkup(React.createElement(LibraryToolbar,{query}));
 assert.equal((html.match(/name="topic"/g)||[]).length,1);
 assert.equal((html.match(/name="documentType"/g)||[]).length,1);
 assert.match(html,/name="source" value="gmail"/);assert.match(html,/<details open=""/);
 assert.match(html,/value="User topic"/);assert.match(html,/<option value="notice" selected=""/);
});
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

test('planner preserves review dates and separates completed and expired exact times',()=>{
 const {plannerGroup,matchesPlannerFilter}=load('src/components/actions/planner-model.ts');
 const task={kind:'action',actionId:'a',title:'task',type:'required',status:'open',deadlineStatus:'confirmed',deadlineDate:'2026-10-13',deadlineAt:null,sources:[]};
 const today='2026-10-13', now=Date.parse('2026-10-13T12:00:00+09:00');
 assert.equal(plannerGroup(task,today,now),'today');
 assert.equal(plannerGroup({...task,deadlineAt:'2026-10-13T10:00:00+09:00'},today,now),'overdue');
 assert.equal(plannerGroup({...task,deadlineStatus:'needs_review'},today,now),'undated');
 assert.equal(matchesPlannerFilter({...task,deadlineStatus:'needs_review'},'today',today),false);
 assert.equal(plannerGroup({...task,status:'completed',deadlineAt:'2026-10-13T10:00:00+09:00'},today,now),'completed');
 assert.equal(matchesPlannerFilter({...task,status:'completed'},'all',today),true);
 assert.equal(matchesPlannerFilter({...task,status:'completed'},'today',today),false);
});

test('planner week stops on Seoul Sunday and upcoming excludes today',()=>{
 const {plannerGroup,matchesPlannerFilter}=load('src/components/actions/planner-model.ts');
 const task={kind:'action',actionId:'a',title:'task',type:'required',status:'open',deadlineStatus:'confirmed',deadlineDate:'2026-10-18',deadlineAt:null,sources:[]};
 const today='2026-10-13',now=Date.parse('2026-10-13T00:00:00+09:00');
 assert.equal(plannerGroup(task,today,now),'week');
 assert.equal(matchesPlannerFilter(task,'week',today),true);
 assert.equal(matchesPlannerFilter({...task,deadlineDate:'2026-10-19'},'week',today),false);
 assert.equal(plannerGroup({...task,deadlineDate:'2026-10-19'},today,now),'upcoming');
 assert.equal(matchesPlannerFilter({...task,deadlineDate:today},'upcoming',today),false);
 assert.equal(matchesPlannerFilter({...task,deadlineDate:'2026-10-14'},'upcoming',today),true);
});
