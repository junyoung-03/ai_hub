import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { pdfFixture } from './upload-fixtures.mjs';
import { isolatedInspect } from '../workers/upload/isolate.mjs';
import { fixture, content, quote } from './analysis-fixtures.mjs';
import { loadAnalysisModule } from './analysis-loader.mjs';

const require = createRequire(import.meta.url);

function load(path, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const env = {
    GEMINI_MODEL: 'gemini-3.7-flash',
    GEMINI_API_KEY: 'synthetic-key',
    GOOGLE_DATA_CLIENT_ID: 'synthetic-client-id',
    GOOGLE_DATA_CLIENT_SECRET: 'synthetic-client-secret',
    GOOGLE_DATA_REDIRECT_URI: 'http://localhost/api/v1/connections/google/callback',
    ...(globals.process?.env || {}),
  };
  runInNewContext(code, {
    exports, Buffer, TextEncoder, TextDecoder, URL, URLSearchParams, Request, Response,
    AbortSignal, AbortController, Date, setTimeout, clearTimeout, queueMicrotask,
    ...globals,
    process: { env },
    require(name) {
      if (name === 'server-only') return {};
      if (name in imports) return imports[name];
      if (name.startsWith('node:') || ['ajv', 'ajv-formats', 'sharp'].includes(name)) return require(name);
      throw new Error(`Missing test dependency: ${name}`);
    },
  });
  return exports;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. PDF REGRESSION TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('PDF regression: mixed text/image page prioritizes embedded text and does not fail with PDF_LAYOUT_NEEDS_REVIEW', async () => {
  const bytes = pdfFixture(['ambiguous']);
  const plan = await isolatedInspect(bytes, 'application/pdf');
  assert.equal(plan.pages.length, 1);
  assert.equal(plan.pages[0].method, 'embedded');
  assert.equal(plan.pages[0].text, 'Synthetic fixture text');
});

test('PDF regression: standard PDF 1.5+ XRef stream (/Type /XRef and /XRefStm) parses safely', async () => {
  const bytes = pdfFixture(['text'], '/XRefStm 123');
  const plan = await isolatedInspect(bytes, 'application/pdf');
  assert.equal(plan.pages.length, 1);
  assert.equal(plan.pages[0].method, 'embedded');
});

test('PDF regression: browser file with empty file.type and .pdf extension normalizes to application/pdf', async () => {
  let createdPayload = null;
  const mockFetch = async (url, options) => {
    if (url.endsWith('/api/v1/uploads')) {
      createdPayload = JSON.parse(options.body);
      return Response.json({ uploadId: 'up-123', itemId: 'item-123', state: 'complete' });
    }
    if (url.includes('/prepare')) {
      return Response.json({ state: 'complete', itemId: 'item-123' });
    }
    return Response.json({});
  };
  const flow = load('src/lib/uploads/browser/flow.ts', {}, { fetch: mockFetch });
  const fakeFile = { name: 'report_2026.PDF', type: '', size: 2048 };
  const res = await flow.runUpload({
    file: fakeFile,
    checkpoint: { uploadId: '', idempotencyKey: 'key-1' },
    signal: new AbortController().signal,
    onCheckpoint: () => {},
    onPhase: () => {},
    onProgress: () => {},
  });
  assert.equal(res.state, 'complete');
  assert.equal(createdPayload.mimeType, 'application/pdf');
  assert.equal(createdPayload.fileName, 'report_2026.PDF');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. GOOGLE DRIVE & CALENDAR REGRESSION TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('Google regression: refresh response scope missing preserves granted scopes when requireScopeResponse is false', async () => {
  const granted = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/drive.metadata.readonly'];
  const dataOAuth = load('src/lib/google/data-oauth.ts', {}, {
    fetch: async () => Response.json({
      access_token: 'new-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      // scope is intentionally omitted by Google
    }),
  });
  const refreshed = await dataOAuth.refreshGoogleAccessToken('refresh-token-xyz', granted, false);
  assert.equal(refreshed.accessToken, 'new-access-token');
  assert.deepEqual(Array.from(refreshed.scopes), [...granted]);
});

test('Google regression: Drive 401 Unauthorized triggers 1 forced refresh and retries once to success', async () => {
  const scopes = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/drive.metadata.readonly', 'https://www.googleapis.com/auth/documents.readonly'];
  let getCalls = 0;
  let refreshCalls = 0;
  let currentTokens = {
    accessToken: 'initial-token', scopes, refreshToken: 'refresh-xyz', accessTokenCiphertext: 'c', expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };

  const driveContract = load('src/lib/google/drive-contract.ts');
  const driveClientModule = load('src/lib/google/drive-client.ts', {
    '@/lib/google/drive-contract': driveContract,
    '@/lib/google/data-oauth': {
      DRIVE_DOCS_SCOPES: scopes.slice(1),
      refreshGoogleAccessToken: async () => {
        refreshCalls++;
        return { accessToken: 'refreshed-token', scopes, tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), refreshToken: null };
      },
    },
    '@/lib/google/connections': {
      getGoogleConnectionTokens: async () => currentTokens,
      getGoogleOAuthConnection: async () => ({ id: 'conn-1', status: 'connected', scopes }),
      refreshGoogleConnectionTokens: async (_u, _c, next) => {
        currentTokens = { ...currentTokens, ...next };
        return true;
      },
    },
  }, {
    fetch: async () => {
      getCalls++;
      if (getCalls === 1) {
        return new Response('Unauthorized', { status: 401 });
      }
      return Response.json({ id: 'file1', name: 'File 1', mimeType: driveContract.DOCS_MIME, trashed: false, parents: [], createdTime: '2026-01-01T00:00:00Z', modifiedTime: '2026-01-01T00:00:00Z' });
    },
  });

  const client = await driveClientModule.createDriveClient('user-1', 'conn-1');
  const file = await client.file('file1', AbortSignal.timeout(5000));
  assert.equal(file.id, 'file1');
  assert.equal(getCalls, 2);
  assert.equal(refreshCalls, 1);
});

test('Google regression: Calendar 401 Unauthorized triggers 1 forced refresh and retries once to success', async () => {
  const calendarScope = 'https://www.googleapis.com/auth/calendar.events.owned.readonly';
  const scopes = ['https://www.googleapis.com/auth/gmail.readonly', calendarScope];
  let getCalls = 0;
  let refreshCalls = 0;
  let currentTokens = {
    accessToken: 'initial-token', scopes, refreshToken: 'refresh-xyz', accessTokenCiphertext: 'c', expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };

  const calendarContract = load('src/lib/google/calendar-contract.ts');
  const calendarClientModule = load('src/lib/google/calendar-client.ts', {
    '@/lib/google/calendar-contract': calendarContract,
    '@/lib/google/data-oauth': {
      CALENDAR_SCOPE: calendarScope,
      refreshGoogleAccessToken: async () => {
        refreshCalls++;
        return { accessToken: 'refreshed-token', scopes, tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), refreshToken: null };
      },
    },
    '@/lib/google/connections': {
      getGoogleConnectionTokens: async () => currentTokens,
      getGoogleOAuthConnection: async () => ({ id: 'conn-1', status: 'connected', scopes }),
      refreshGoogleConnectionTokens: async (_u, _c, next) => {
        currentTokens = { ...currentTokens, ...next };
        return true;
      },
    },
  }, {
    fetch: async () => {
      getCalls++;
      if (getCalls === 1) {
        return new Response('Unauthorized', { status: 401 });
      }
      return Response.json({
        id: 'event-1', status: 'confirmed', start: { dateTime: '2026-10-15T10:00:00Z' }, end: { dateTime: '2026-10-15T11:00:00Z' }, summary: 'Meeting',
      });
    },
  });

  const client = await calendarClientModule.createCalendarClient('user-1', 'conn-1');
  const event = await client.event('event-1', AbortSignal.timeout(5000));
  assert.equal(event.id, 'event-1');
  assert.equal(getCalls, 2);
  assert.equal(refreshCalls, 1);
});

test('Google regression: Calendar start === end event is permitted, while start > end is rejected', () => {
  const calendarContract = load('src/lib/google/calendar-contract.ts');
  const zeroDurationDateTime = {
    id: 'zero-event',
    status: 'confirmed',
    start: { dateTime: '2026-10-15T10:00:00Z' },
    end: { dateTime: '2026-10-15T10:00:00Z' },
    summary: 'Milestone snapshot',
  };
  const parsedZero = calendarContract.parseEvent(zeroDurationDateTime, 'Asia/Seoul', (h) => h);
  assert.ok(parsedZero);
  assert.equal(parsedZero.eventId, 'zero-event');

  const zeroDurationDate = {
    id: 'zero-day',
    status: 'confirmed',
    start: { date: '2026-10-15' },
    end: { date: '2026-10-15' },
    summary: 'Single day',
  };
  const parsedDate = calendarContract.parseEvent(zeroDurationDate, 'Asia/Seoul', (h) => h);
  assert.ok(parsedDate);

  const inverted = {
    id: 'bad-event',
    status: 'confirmed',
    start: { dateTime: '2026-10-15T12:00:00Z' },
    end: { dateTime: '2026-10-15T10:00:00Z' },
  };
  assert.throws(() => calendarContract.parseEvent(inverted, 'Asia/Seoul', (h) => h), /INVALID_EVENT/);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. GEMINI RETRY & TIMEOUT TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

for (const status of [500, 502, 503, 504]) {
  test(`Gemini regression: HTTP ${status} error retries and succeeds on next attempt`, async () => {
    let attempts = 0;
    const validator = loadAnalysisModule('src/lib/gemini/validation.ts');
    const providerFixture = () => ({
      ...fixture(),
      schemaVersion: '0.3',
      noiseAssessment: { verdict: 'normal', confidence: null, evidence: [], reasons: ['non_promotional'], protectionSignals: [] },
    });
    const client = loadAnalysisModule('src/lib/gemini/client.ts', { '@/lib/gemini/validation': validator }, {
      process: { env: { GEMINI_API_KEY: 'synthetic-key', GEMINI_MODEL: 'gemini-3.7-flash' } },
      fetch: async () => {
        attempts++;
        if (attempts === 1) {
          return new Response('Transient provider error', { status });
        }
        return Response.json({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(providerFixture()) }] } }],
        });
      },
    });

    const res = await client.analyzeGmailText(content, [], undefined, '0.3');
    assert.equal(res.schemaVersion, '0.3');
    assert.equal(attempts, 2);
  });
}

test('Gemini regression: persistent 5xx exhausts retries budget and fails with GEMINI_UNAVAILABLE', async () => {
  let attempts = 0;
  const validator = loadAnalysisModule('src/lib/gemini/validation.ts');
  const client = loadAnalysisModule('src/lib/gemini/client.ts', { '@/lib/gemini/validation': validator }, {
    process: { env: { GEMINI_API_KEY: 'synthetic-key', GEMINI_MODEL: 'gemini-3.7-flash' } },
    fetch: async () => {
      attempts++;
      return new Response('Server Down', { status: 503 });
    },
  });

  await assert.rejects(
    client.analyzeGmailText(content, [], undefined, '0.3'),
    (err) => err.code === 'GEMINI_UNAVAILABLE'
  );
  assert.ok(attempts >= 3, `Expected at least 3 attempts, got ${attempts}`);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. EVIDENCE NORMALIZATION TESTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

test('Evidence regression: CRLF and LF differences match correctly', () => {
  const validator = loadAnalysisModule('src/lib/gemini/validation.ts');
  const rawDocument = '안내\r\n참가 신청은 2026년 10월 15일까지 접수합니다.\r\n감사합니다.';
  const sample = fixture();
  sample.eventObservations = [];
  const normalizedSentence = '참가 신청은 2026년 10월 15일까지 접수합니다.';
  sample.actions[0].evidence = [quote(normalizedSentence)];
  sample.actions[0].deadlineObservation.evidence = quote(normalizedSentence);
  sample.actions[0].deadlineObservation.rawText = '2026년 10월 15일까지';

  const validated = validator.validateAnalysis(sample, rawDocument);
  const matched = validated.actions[0].evidence[0];
  assert.equal(matched.locator.kind, 'text_span');
  const extracted = Array.from(rawDocument).slice(matched.locator.startChar, matched.locator.endChar).join('');
  assert.equal(extracted, normalizedSentence);
});

test('Evidence regression: repeated whitespace and tab differences match correctly', () => {
  const validator = loadAnalysisModule('src/lib/gemini/validation.ts');
  const rawDocument = '안내\n참가   신청은 \t 2026년 10월 15일까지   접수합니다.\n감사합니다.';
  const sample = fixture();
  sample.eventObservations = [];
  const normalizedSentence = '참가 신청은 2026년 10월 15일까지 접수합니다.';
  sample.actions[0].evidence = [quote(normalizedSentence)];
  sample.actions[0].deadlineObservation.evidence = quote(normalizedSentence);
  sample.actions[0].deadlineObservation.rawText = '2026년 10월 15일까지';

  const validated = validator.validateAnalysis(sample, rawDocument);
  const matched = validated.actions[0].evidence[0];
  assert.equal(matched.locator.kind, 'text_span');
  const extracted = Array.from(rawDocument).slice(matched.locator.startChar, matched.locator.endChar).join('');
  assert.equal(extracted, '참가   신청은 \t 2026년 10월 15일까지   접수합니다.');
});

test('Evidence regression: actual semantic mismatch continues to be rejected', () => {
  const validator = loadAnalysisModule('src/lib/gemini/validation.ts');
  const rawDocument = '전혀 다른 내용의 본문 텍스트입니다.';
  const sample = fixture();
  sample.actions[0].evidence[0].text = '본문에 없는 완전히 지어낸 증거 문장입니다.';
  assert.throws(
    () => validator.validateAnalysis(sample, rawDocument),
    validator.AnalysisValidationError
  );
});
