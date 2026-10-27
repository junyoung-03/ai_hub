import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { loadSearch } from './helpers/search-loader.mjs';

const require = createRequire(import.meta.url);
const owner = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const contract = loadSearch('src/lib/search/contract.ts');
const service = loadSearch('src/lib/search/service.ts', {
  '@/lib/supabase/auth': { requireUser: async () => ({ id: owner }) },
  '@/lib/supabase/admin': { createAdminClient: () => null },
});
const provider = { identity: contract.ACTIVE_EMBEDDING, embedDocument() { throw new Error('No provider calls expected'); } };

function indexStore({ cached = false, matched = true, alreadyComplete = false, unchanged = false, status = 'indexing', retryAfter = null } = {}) {
  const operations = [], predicates = [];
  let reads = 0;
  const item = { id, user_id: owner, title: 'Synthetic', content_text: 'Synthetic text', source: 'gmail', metadata: {}, processing_status: status, updated_at: 'revision-one' };
  return { operations, predicates, admin: { from(table) {
    let updating = false;
    const q = {
      select() { return q; }, update() { updating = true; return q; },
      eq(key, value) { if (updating) predicates.push([key, value]); return q; },
      limit: async () => ({ data: [] }),
      maybeSingle: async () => ({ data: updating ? (matched ? { id } : null) : reads++ === 0 ? item : alreadyComplete || unchanged ? { id } : null, error: null }),
    };
    assert.ok(['items', 'search_chunks'].includes(table));
    return q;
  } }, async call(name, args) {
    assert.equal(args.p_user_id, owner);
    operations.push(name === 'retry_search_index' ? 'atomic_retry' : args.p_op);
    if (name === 'retry_search_index') return retryAfter && Date.parse(retryAfter) > Date.now() ? { state: 'failed', retryAfter } : { state: 'pending' };
    if (args.p_op === 'rate') return { allowed: true };
    if (args.p_op === 'read') return { state: 'failed', retryAfter };
    if (args.p_op === 'claim') return cached ? { state: 'complete' } : { state: 'claimed', attempt: id, nextChunk: 0 };
    return {};
  } };
}

test('a source change after index finish never reports complete or fails the already-finished index job', async () => {
  for (const cached of [false, true]) {
    const store = indexStore({ matched: false, cached });
    await assert.rejects(() => service.indexItem(id, provider, store), error => error.code === 'STALE_INPUT' && error.status === 409);
    assert.equal(store.operations.includes('fail'), false);
    assert.deepEqual(store.predicates, [['user_id', owner], ['id', id], ['updated_at', 'revision-one'], ['processing_status', 'indexing']]);
  }
});

test('same-revision already-completed index resumption is idempotent', async () => {
  const store = indexStore({ matched: false, cached: true, alreadyComplete: true });
  assert.equal((await service.indexItem(id, provider, store)).state, 'complete');
  assert.equal(store.operations.includes('write'), false);
});

test('explicit retry respects cooldown and resets exhausted attempts only after it expires', async () => {
  const waiting = indexStore({ retryAfter: new Date(Date.now() + 60000).toISOString() });
  assert.equal((await service.indexItem(id, provider, waiting, true)).state, 'failed');
  assert.deepEqual(waiting.operations, ['rate', 'atomic_retry']);
  const ready = indexStore({ retryAfter: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await service.indexItem(id, provider, ready, true)).state, 'complete');
  assert.equal(ready.operations.filter(op => op === 'atomic_retry').length, 1);
});

test('independent keyword indexing preserves queued/failed/Calendar-compatible statuses and still detects a changed snapshot', async () => {
  for (const status of ['queued', 'failed', 'completed']) {
    const store = indexStore({ status, unchanged: true });
    assert.equal((await service.indexItem(id, provider, store)).state, 'complete');
    assert.equal(store.predicates.length, 0);
    const stale = indexStore({ status });
    await assert.rejects(() => service.indexItem(id, provider, stale), error => error.code === 'STALE_INPUT');
  }
});

function ui(path, component, fetcher) {
  const states = [], refs = [];
  let stateIndex = 0, refIndex = 0, tree, refreshes = 0;
  const exports = {};
  const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  runInNewContext(source, { exports, Date, setTimeout, clearTimeout, fetch: fetcher, Event,
    window: { dispatchEvent() {} }, require(name) {
      if (name === 'react') return {
        useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
        useRef(initial) { const index = refIndex++; refs[index] ??= { current: initial }; return refs[index]; },
        useEffect() {},
      };
      if (name === 'next/navigation') return { useRouter: () => ({ refresh() { refreshes++; } }) };
      if (name === 'next/link') return { __esModule: true, default: 'a' };
      if (name === '@/lib/search/index-progress') return loadSearch('src/lib/search/index-progress.ts');
      return require(name);
    },
  });
  const flatten = node => !node ? [] : Array.isArray(node) ? node.flatMap(flatten) : typeof node === 'object' ? [node, ...flatten(node.props?.children)] : [node];
  return {
    render() { stateIndex = refIndex = 0; tree = exports[component]({ itemId: id }); return tree; },
    find(predicate) { return flatten(tree).find(node => node && typeof node === 'object' && predicate(node)); },
    text() { return flatten(tree).filter(node => typeof node === 'string').join(' '); },
    get refreshes() { return refreshes; },
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
test('index button preserves progress, resets only on explicit retry, and reports complete only on completion', async () => {
  const requests = [];
  const replies = ['pending', 'failed', 'complete'];
  const harness = ui('src/components/items/search-index-control.tsx', 'SearchIndexControl', async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return Response.json({ state: replies.shift() });
  });
  for (const expected of ['일부 완료', '중단', '검색 준비가 완료']) {
    harness.render(); harness.find(node => node.type === 'button').props.onClick(); await flush(); harness.render();
    assert.match(harness.text(), new RegExp(expected));
  }
  assert.deepEqual(requests.map(request => request.body), [{}, {}, { retry: true }]);
  assert.ok(requests.every(request => request.url.endsWith('/index')));
  assert.equal(harness.refreshes, 3);
});

test('index cooldown disables immediate repeated requests', async () => {
  let requests = 0;
  const harness = ui('src/components/items/search-index-control.tsx', 'SearchIndexControl', async () => {
    requests++; return Response.json({ error: { code: 'RATE_LIMITED' } }, { status: 429, headers: { 'Retry-After': '60' } });
  });
  harness.render(); harness.find(node => node.type === 'button').props.onClick(); await flush(); harness.render();
  assert.equal(harness.find(node => node.type === 'button').props.disabled, true);
  harness.find(node => node.type === 'button').props.onClick(); await flush();
  assert.equal(requests, 1);
});

test('manual text preserves saved data and accurately reports pending, failed, and queued downstream work', async () => {
  for (const scenario of ['pending', 'failed', 'queued']) {
    const requests = [];
    const harness = ui('src/components/items/manual-text-controls.tsx', 'ManualTextControls', async url => {
      requests.push(url);
      if (url.endsWith('/manual')) return Response.json({ itemId: id });
      if (url.endsWith('/analyze')) return Response.json({ processing_status: scenario === 'queued' ? 'queued' : 'indexing' }, { status: scenario === 'queued' ? 202 : 200 });
      return scenario === 'failed' ? Response.json({}, { status: 503 }) : Response.json({ state: 'pending', nextChunk: 8, chunkCount: 16 });
    });
    harness.render(); harness.find(node => node.type === 'textarea').props.onChange({ target: { value: 'Synthetic content' } });
    harness.render(); await harness.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); harness.render();
    assert.match(harness.text(), scenario === 'queued' ? /AI 분석 요청이 접수/ : scenario === 'failed' ? /검색 준비에 실패/ : /검색 준비가 일부 완료/);
    assert.equal(requests.length, scenario === 'queued' ? 2 : 3);
    assert.ok(harness.find(node => node.props.href === `/items/${id}`));
    assert.doesNotMatch(harness.text(), /검색 준비가 완료되었습니다/);
  }
});
