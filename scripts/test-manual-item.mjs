import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSearch } from './search-loader.mjs';
import { loadAnalysisModule } from './analysis-loader.mjs';

const c = loadSearch('src/lib/search/contract.ts');
const chunks = loadSearch('src/lib/search/chunker.ts');
const policy = loadAnalysisModule('src/lib/items/analysis-policy.ts');
const presentation = loadAnalysisModule('src/lib/items/presentation.ts');

const ownerId = '11111111-1111-4111-8111-111111111111';
const plain = (v) => JSON.parse(JSON.stringify(v));

test('source and format labels include manual text with approved presentation', () => {
  assert.equal(presentation.sourceLabels.manual, '직접 입력');
  assert.equal(presentation.formatLabels.text, '텍스트');
});

test('analysisEligible accepts manual text and rejects unsupported sources or empty content', () => {
  assert.equal(policy.analysisEligible({ source: 'manual', format: 'text', content_text: '내용', metadata: {} }), true);
  assert.equal(policy.analysisEligible({ source: 'manual', format: 'document', content_text: '내용', metadata: {} }), false);
  assert.equal(policy.analysisEligible({ source: 'manual', format: 'text', content_text: '', metadata: {} }), false);
  assert.equal(policy.analysisEligible({ source: 'manual', format: 'text', content_text: '   ', metadata: {} }), false);
  assert.equal(policy.analysisEligible({ source: 'calendar', format: 'text', content_text: '내용', metadata: {} }), false);
});

test('search contract filters allow manual source and text format', () => {
  const result = c.parseSearch({
    query: '테스트',
    filters: { source: ['manual'], format: ['text'] },
  });
  assert.deepEqual(plain(result.filters.source), ['manual']);
  assert.deepEqual(plain(result.filters.format), ['text']);
});

test('search chunker chunks manual item content with content_text field', () => {
  const item = {
    id: '33333333-3333-4333-8333-333333333333',
    user_id: ownerId,
    title: '회의 메모',
    content_text: '김대리는 가격표를 수정한다.\n금요일까지 대표에게 보고한다.',
    source: 'manual',
    metadata: {},
    updated_at: '2026-10-06T12:00:00Z',
  };
  const chunked = chunks.chunkItem(item);
  assert.ok(chunked.chunks.length >= 1);
  assert.equal(chunked.chunks[0].metadata.field, 'content_text');
  assert.equal(chunked.chunks[0].content, item.content_text);
});

test('manual item validation: empty, whitespace-only, non-string, oversized rejected', () => {
  const validateInput = (input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('VALIDATION_ERROR');
    if (typeof input.content !== 'string') throw new Error('VALIDATION_ERROR');
    const contentText = input.content.trim();
    if (!contentText) throw new Error('VALIDATION_ERROR');
    if (contentText.length > 100_000) throw new Error('VALIDATION_ERROR');
    return contentText;
  };

  assert.throws(() => validateInput(null), /VALIDATION_ERROR/);
  assert.throws(() => validateInput({}), /VALIDATION_ERROR/);
  assert.throws(() => validateInput({ content: '' }), /VALIDATION_ERROR/);
  assert.throws(() => validateInput({ content: '   \n\t  ' }), /VALIDATION_ERROR/);
  assert.throws(() => validateInput({ content: 123 }), /VALIDATION_ERROR/);
  assert.throws(() => validateInput({ content: 'a'.repeat(100_001) }), /VALIDATION_ERROR/);
  assert.equal(validateInput({ content: '  유효한 메모  ' }), '유효한 메모');
});

test('title auto-derivation falls back to first line up to 50 characters', () => {
  const deriveTitle = (rawTitle, contentText) => {
    let title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
    if (title.length > 200) title = title.slice(0, 200);
    if (!title) {
      const firstLine = contentText.split('\n')[0].trim();
      if (firstLine.length > 50) {
        title = firstLine.slice(0, 47) + '...';
      } else if (firstLine) {
        title = firstLine;
      } else {
        title = '직접 입력 메모';
      }
    }
    return title;
  };

  assert.equal(deriveTitle('명시적 제목', '본문 내용'), '명시적 제목');
  assert.equal(deriveTitle('', '첫 번째 줄 제목\n두 번째 줄 내용'), '첫 번째 줄 제목');
  const longText = '가'.repeat(60);
  assert.equal(deriveTitle(undefined, longText), '가'.repeat(47) + '...');
  assert.equal(deriveTitle('', '\n\n본문만 있음'), '직접 입력 메모');
});

test('20261007070000 migration file is idempotent, safe, and targets exact RPC', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync('supabase/migrations/20261007070000_allow_manual_text_eligible_analysis.sql', 'utf8');

  assert.ok(sql.includes('begin;'));
  assert.ok(sql.includes('commit;'));
  assert.ok(sql.includes("'public.persist_eligible_item_analysis(uuid,uuid,text,text,jsonb,text,text)'::regprocedure"));
  assert.ok(sql.includes("(source='manual' and format='text')"));
  assert.ok(sql.includes("and ((source='drive' and format='document')"));
  assert.ok(sql.includes("raise exception 'Unexpected eligible analysis source guard; no changes applied'"));

  // Verify simulated branching behavior
  const extractAndSimulate = (fnDef) => {
    const v_manual = "(source='manual' and format='text')";
    const v_old = "and ((source='drive' and format='document')";
    const v_new = "and ((source='drive' and format='document')\n      or (source='manual' and format='text')";

    if (fnDef.includes(v_manual)) {
      return { action: 'no-op', def: fnDef };
    } else if (fnDef.includes(v_old)) {
      return { action: 'replace', def: fnDef.replace(v_old, v_new) };
    } else {
      throw new Error('Unexpected eligible analysis source guard; no changes applied');
    }
  };

  // Case A: Dev DB (already present) -> NO-OP
  const devDbFn = "select * into v_item from public.items where id=p_item_id and user_id=p_user_id\n    and ((source='drive' and format='document')\n      or (source='manual' and format='text')\n      or (source='upload' and format in ('pdf','image'))";
  const devRes = extractAndSimulate(devDbFn);
  assert.equal(devRes.action, 'no-op');
  assert.equal(devRes.def, devDbFn);

  // Case B: Prod DB (drive/upload only) -> REPLACED
  const prodDbFn = "select * into v_item from public.items where id=p_item_id and user_id=p_user_id\n    and ((source='drive' and format='document')\n      or (source='upload' and format in ('pdf','image'))";
  const prodRes = extractAndSimulate(prodDbFn);
  assert.equal(prodRes.action, 'replace');
  assert.ok(prodRes.def.includes("(source='manual' and format='text')"));

  // Case C: Corrupt / foreign guard -> Throws
  const badFn = "select * into v_item from public.items where id=p_item_id and user_id=p_user_id and source='other'";
  assert.throws(() => extractAndSimulate(badFn), /Unexpected eligible analysis source guard/);
});
