'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { readIndexProgress } from '@/lib/search/index-progress';

export function ManualTextControls({ userId }: { userId?: string } = {}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDetailsElement | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [errorText, setErrorText] = useState('');
  const [createdItemId, setCreatedItemId] = useState<string>();
  const isRunning = useRef(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (isRunning.current || !content.trim()) return;

    isRunning.current = true;
    setBusy(true);
    setErrorText('');
    setStatusText('저장 중...');

    try {
      // 1. Create ITEM
      const createRes = await fetch('/api/v1/items/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || undefined,
          content: content.trim(),
        }),
      });

      if (!createRes.ok) {
        const errorJson = await createRes.json().catch(() => ({}));
        throw new Error(errorJson?.error?.message || '자료를 저장하지 못했습니다.');
      }

      const createData = await createRes.json();
      const itemId = createData.itemId;
      setCreatedItemId(itemId);
      router.refresh();

      // 2. AI Analysis
      setStatusText('AI 분석 중...');
      let analysisSucceeded = false;
      let analysisQueued = false;
      try {
        const analyzeRes = await fetch(`/api/v1/items/${itemId}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const analysis: unknown = await analyzeRes.json().catch(() => null);
        const analysisState = analysis && typeof analysis === 'object' && 'processing_status' in analysis ? analysis.processing_status : null;
        analysisQueued = analyzeRes.ok && (analyzeRes.status === 202 || analysisState === 'queued' || analysisState === 'analyzing');
        analysisSucceeded = analyzeRes.ok && !analysisQueued && (analysisState === 'indexing' || analysisState === 'completed');
      } catch {
        analysisSucceeded = false;
      }

      // 3. Search Indexing
      if (analysisSucceeded) {
        setStatusText('검색 색인 중...');
        try {
          const indexResponse = await fetch(`/api/v1/items/${itemId}/index`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          const progress = await readIndexProgress(indexResponse);
          setStatusText(`저장 및 AI 분석 완료 · ${progress.message}`);
        } catch {
          setStatusText('저장 및 AI 분석 완료 · 검색 준비에 실패했습니다. 상세에서 재시도해 주세요.');
        }
      } else if (analysisQueued) {
        setStatusText('저장 완료 · AI 분석 요청이 접수되었습니다. 상세에서 처리 상태를 확인하세요.');
      } else {
        setStatusText('저장 완료 · AI 분석 실패 (상세 페이지에서 재시도할 수 있습니다)');
      }

      window.dispatchEvent(new Event('ai-hub:items-changed'));
      window.dispatchEvent(new Event('ai-hub:actions-changed'));
      router.refresh();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : '요청을 처리하지 못했습니다.');
      setStatusText('');
    } finally {
      isRunning.current = false;
      setBusy(false);
    }
  }

  function handleReset() {
    setTitle('');
    setContent('');
    setStatusText('');
    setErrorText('');
    setCreatedItemId(undefined);
  }

  return (
    <details ref={panelRef} id="manual-text" data-user-id={userId} className="panel mb-7 scroll-mt-20" aria-busy={busy}>
      <summary className="cursor-pointer text-base font-medium" id="manual-text-title">
        직접 텍스트 입력{' '}
        <span className="ml-2 text-sm font-normal text-muted-foreground">메모 · 복사한 글</span>
      </summary>
      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <p className="mt-1 text-sm text-muted-foreground">
            복사한 텍스트나 메모를 직접 작성하여 자료로 추가합니다. 저장 후 본문을 Gemini로 보내 AI 분석(할 일, 마감일, 일정, 분류, 근거)을 수행합니다.
          </p>
        </div>

        <div>
          <label htmlFor="manual-title" className="block text-sm font-medium mb-1.5">
            제목 <span className="text-xs text-muted-foreground font-normal">(선택 · 비워두면 첫 줄 자동 사용)</span>
          </label>
          <input
            id="manual-title"
            type="text"
            className="w-full rounded-lg border border-line bg-canvas px-3.5 py-2 text-sm text-ink placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="예: 세미나 참가 메모"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            maxLength={200}
          />
        </div>

        <div>
          <label htmlFor="manual-content" className="block text-sm font-medium mb-1.5">
            내용 <span className="text-xs text-rose font-normal">*</span>
          </label>
          <textarea
            id="manual-content"
            rows={6}
            className="w-full rounded-lg border border-line bg-canvas p-3.5 text-sm text-ink placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="카카오톡, 회의 메모, 웹페이지에서 복사한 내용을 붙여넣으세요."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={busy}
            required
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn-primary"
            type="submit"
            disabled={busy || !content.trim()}
          >
            {busy ? (statusText || '처리 중...') : '저장하고 AI 분석'}
          </button>
          <button
            className="btn-secondary"
            type="button"
            disabled={busy}
            onClick={handleReset}
          >
            새로 쓰기
          </button>
          {createdItemId && (
            <Link className="btn-secondary" href={`/items/${createdItemId}`}>
              자료 확인 →
            </Link>
          )}
        </div>

        {statusText && <p role="status" className="text-sm text-muted-foreground">{statusText}</p>}
        {errorText && <p role="alert" className="text-sm text-rose">{errorText}</p>}
      </form>
    </details>
  );
}
