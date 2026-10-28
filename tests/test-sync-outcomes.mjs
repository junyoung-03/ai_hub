import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const oldTime = '2026-10-01T01:00:00Z', serverTime = '2026-10-27T02:00:00Z';
const gmail = changes => ({ created_count: 0, updated_count: 0, skipped_count: 0, failed_count: 0, collected_count: 0, complete: true, capped: false, ...changes });
const collection = changes => ({ created: 0, updated: 0, reused: 0, failed: 0, unprocessed: 0, complete: true, capped: false, stopReason: null, ...changes });

function panelHarness(fetcher, summaryChanges = {}) {
  const state = [], cache = new Map();
  let hook = 0, refreshes = 0;
  const react = { useState(initial) {
    const key = hook++;
    if (!(key in state)) state[key] = typeof initial === 'function' ? initial() : initial;
    return [state[key], value => { state[key] = typeof value === 'function' ? value(state[key]) : value; }];
  } };
  const jsx = (type, props) => ({ type, props });
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const output = {};
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    runInNewContext(code, { exports: output, URL, Date, Response, Request, fetch: fetcher, require(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (name === 'next/navigation') return { useRouter: () => ({ refresh() { refreshes++; } }) };
      if (name === 'next/link') return { default: 'a' };
      if (name === 'lucide-react') return { Mail: 'mail-icon', Folder: 'folder-icon', CalendarDays: 'calendar-icon', RefreshCw: 'refresh-icon' };
      if (name === '@/lib/items/presentation') return { formatTimestamp: value => value, formatRelativeTime: value => value };
      if (name.startsWith('@/')) return load(`src/${name.slice(2)}.ts`);
      throw new Error(`Unexpected dependency ${name}`);
    } });
    cache.set(file, output);
    return output;
  }
  const props = {
    connection: { id: 'synthetic', status: 'connected', accountEmail: 'synthetic@example.invalid', lastSyncedAt: oldTime, capabilities: { gmail: true, drive: true, calendar: true } },
    syncSummary: { services: Object.fromEntries(['gmail', 'drive', 'calendar'].map(service => [service, { status: 'connected', lastSyncedAt: oldTime, lastResult: null, ...summaryChanges[service] }])) },
    notice: null,
  };
  const { GoogleConnectionPanel } = load('src/components/connections/google-connection-panel.tsx');
  const render = () => { hook = 0; return GoogleConnectionPanel(props); };
  const current = () => state.find(value => value && typeof value === 'object' && value.gmail && value.drive && value.calendar);
  function setTarget(value = 'synthetic-folder') {
    walk(render()).find(node => node.props?.id === 'drive-target').props.onChange({ target: { value } });
  }
  async function sync(service) {
    const tree = render();
    const section = walk(tree).find(node => node.type === 'section' && text(node).includes(service === 'gmail' ? 'Gmail' : service === 'drive' ? 'Google Drive' : 'Google Calendar'));
    const button = walk(section).find(node => node.type === 'button' && text(node) === '지금 동기화');
    assert.ok(button, `missing ${service} sync handler`);
    await button.props.onClick();
  }
  return { render, props, current, setTarget, sync, load, get refreshes() { return refreshes; } };
}

function walk(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  return [node, ...walk(node.props?.children)];
}
function text(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return text(node.props?.children);
}
const messages = harness => walk(harness.render()).filter(node => node.type === 'p' && ['alert', 'status'].includes(node.props?.role)).map(node => ({ role: node.props.role, text: text(node) }));

test('Gmail partial HTTP 200 is not normal and queued AI is separate from collection success', async () => {
  const calls = [];
  const harness = panelHarness(async url => {
    calls.push(url);
    return url.endsWith('/sync') ? Response.json(gmail({ created_count: 1, collected_count: 1, failed_count: 2, analysisItemIds: ['saved-mail'] }))
      : Response.json({ queued: true }, { status: 202 });
  });
  await harness.sync('gmail');
  assert.equal(harness.current().gmail.status, 'partial');
  assert.equal(harness.current().gmail.lastSyncedAt, oldTime);
  assert.match(harness.current().gmail.resultText, /일부 수집.*신규 1건.*실패 2건/);
  assert.equal(calls.length, 2);
  const rendered = messages(harness);
  assert.equal(rendered[0].role, 'alert');
  assert.match(rendered[1].text, /AI 분석 완료 0.*백그라운드 처리 요청 1/);
  assert.doesNotMatch(rendered[1].text, /AI 분석 완료 1/);
});

test('Drive listing failure with zero failed files still marks collection failure', async () => {
  const harness = panelHarness(async () => Response.json(collection({ complete: false, stopReason: 'LIST_FAILED' })));
  harness.setTarget();
  await harness.sync('drive');
  assert.equal(harness.current().drive.status, 'error');
  assert.equal(harness.current().drive.lastSyncedAt, oldTime);
  assert.match(harness.current().drive.resultText, /수집 실패.*목록 조회 실패/);
  assert.equal(messages(harness).length, 1);
});

test('Calendar partial timeout preserves previous success time and reports unprocessed items', async () => {
  const harness = panelHarness(async () => Response.json(collection({ created: 2, complete: false, capped: true, unprocessed: 4, stopReason: 'RUN_TIMEOUT', lastSyncedAt: serverTime })));
  await harness.sync('calendar');
  assert.equal(harness.current().calendar.status, 'partial');
  assert.equal(harness.current().calendar.lastSyncedAt, oldTime);
  assert.match(harness.current().calendar.resultText, /일부 수집.*미처리 4건.*수집 시간 초과/);
});

test('successful response uses server timestamp, then refresh can supply a later authoritative timestamp', async () => {
  const harness = panelHarness(async () => Response.json(collection({ created: 1, last_synced_at: serverTime })));
  await harness.sync('calendar');
  assert.equal(harness.current().calendar.lastSyncedAt, serverTime);
  assert.equal(harness.current().calendar.status, 'connected');
  harness.props.syncSummary.services.calendar.lastSyncedAt = '2026-10-27T03:00:00Z';
  assert.match(text(harness.render()), /마지막 성공 2026-10-27T03:00:00Z/);
  assert.equal(harness.refreshes, 1);
});

test('a successful collection without returned server time never invents a current timestamp', async () => {
  const harness = panelHarness(async () => Response.json(gmail({ collected_count: 1, skipped_count: 1 })));
  await harness.sync('gmail');
  assert.equal(harness.current().gmail.status, 'connected');
  assert.equal(harness.current().gmail.lastSyncedAt, oldTime);
  assert.match(harness.current().gmail.resultText, /이번 수집 완료/);
});

test('bounded Gmail collection reports partial when more mailbox pages exist', async () => {
  const harness = panelHarness(async () => Response.json(gmail({ collected_count: 100, skipped_count: 100, capped: true })));
  await harness.sync('gmail');
  assert.equal(harness.current().gmail.status, 'partial');
  assert.match(harness.current().gmail.resultText, /일부 수집.*최대 100건 범위.*추가 메일 있음/);
  assert.equal(harness.current().gmail.lastSyncedAt, oldTime);
});

test('AI failure and discovery failure do not turn saved collection into collection failure', async () => {
  const harness = panelHarness(async url => url.endsWith('/sync')
    ? Response.json(gmail({ created_count: 1, collected_count: 1, analysisItemIds: ['saved-mail'], analysisDiscoveryFailed: true, lastSyncedAt: serverTime }))
    : Response.json({ error: 'synthetic AI unavailable' }, { status: 503 }));
  await harness.sync('gmail');
  assert.equal(harness.current().gmail.status, 'connected');
  assert.equal(harness.current().gmail.lastSyncedAt, serverTime);
  const rendered = messages(harness);
  assert.match(rendered[0].text, /이번 수집 완료.*후속 AI 대상 확인 실패/);
  assert.equal(rendered[1].role, 'alert');
  assert.match(rendered[1].text, /실패 1.*자료는 저장되어 있습니다/);
});

test('full-sync invokes real panel handlers sequentially after failure and caps follow-up analysis at three', async () => {
  const calls = [];
  const harness = panelHarness(async url => {
    calls.push(url);
    if (url.endsWith('/google/sync')) return Response.json({ error: { code: 'REFRESH_FAILED', message: '다시 연결 필요' } }, { status: 401 });
    if (url.endsWith('/drive/collect')) return Response.json(collection({ created: 4, analysisItemIds: ['one', 'two', 'three', 'four'] }));
    if (url.endsWith('/calendar/collect')) return Response.json(collection({ created: 1 }));
    return Response.json({}, { status: url.includes('/two/') ? 202 : url.includes('/three/') ? 503 : 200 });
  });
  harness.setTarget();
  const button = walk(harness.render()).find(node => node.type === 'button' && text(node) === '전체 동기화');
  await button.props.onClick();
  assert.deepEqual(calls.slice(0, 3), ['/api/v1/connections/google/sync', '/api/v1/connections/google/drive/collect', '/api/v1/connections/google/calendar/collect']);
  assert.equal(calls.length, 6);
  assert.equal(harness.current().gmail.status, 'reconnect_required');
  assert.equal(harness.current().drive.status, 'connected');
  assert.equal(harness.current().calendar.status, 'connected');
  assert.match(messages(harness)[1].text, /완료 1.*실패 1.*처리 요청 1.*대기 1/);
});

test('invalid success payloads fail closed and prior partial outcomes survive initial render', async () => {
  const harness = panelHarness(async () => Response.json([]), {
    drive: { lastResult: collection({ created: 1, failed: 2, complete: false }) },
  });
  harness.render();
  assert.equal(harness.current().drive.status, 'partial');
  await harness.sync('gmail');
  assert.equal(harness.current().gmail.status, 'error');
  assert.equal(harness.current().gmail.lastSyncedAt, oldTime);
  assert.match(harness.current().gmail.resultText, /수집 결과를 확인하지 못했습니다/);
});

test('unknown service success timestamps remain unknown despite a global connection timestamp', () => {
  const harness = panelHarness(() => { throw new Error('no network expected'); }, {
    gmail: { lastSyncedAt: null }, drive: { lastSyncedAt: null }, calendar: { lastSyncedAt: null },
  });
  assert.match(text(harness.render()), /최근 성공 기록 없음/);
  assert.equal(harness.current().gmail.lastSyncedAt, null);
});
