# Upload parser / browser OCR boundary — Upload-3 MVP

Next.js Node server owns Auth/session/Storage/SHA256/dedupe/validation/embedded text and CAS persistence.
`providers.ts` invokes `isolatedInspect` locally, never Cloud Run/ADC/Vision. The existing managed adapter is retained
in `managed-providers.ts` as inactive future code; no MVP service imports it. Cloud deployment scripts are historical only.
Existing ADC and Google OAuth are untouched. Gemini/managed OCR are optional future providers; no automatic fallback.

Local child entrypoint: `workers/upload/child.mjs`, receiving one IPC request, empty environment,
192MiB JS heap, ignored stdio, fixed runtime path, bounded 120s termination and disabled fetch.
Image validation fully decodes via sharp, applies orientation to a derivative, leaves Storage original unchanged.
Server PDF.js preserves conservative structure/layout/security policy and embedded text extraction.
MVP requests use `render:false`: scanned pages are identified without allocating server raster output.
The old `server.mjs` HTTP entrypoint/rendering mode remains for existing offline fixtures; not required for deployment.

5MB original/10 PDF pages/20MP/10k side/64MB total Flate expansion/100k CP/400k text UTF8 limits remain.
Encrypted/active/embedded-file/malformed classic xref reject; xref streams require review;
incremental/hybrid references reject. Same-page text+raster/non-monotonic text order require review.
No script evaluation/XFA/annotations/external font URLs. No partial successful text.
A JS heap cap does NOT cap native allocations. Vercel native memory/time/isolation requires actual deployment verification;
this local child is not a proven replacement for the old Cloud Run container's OS/network boundary.

`src/lib/uploads/browser/ocr-provider.ts` is a generic provider boundary.
`BrowserTesseractProvider` owns exactly one Tesseract.js 7.0.0 Web Worker and wraps its pinned Worker message protocol.
This allows immediate termination during WASM/language initialization, before the public createWorker promise would expose
its handle. Upgrades must test that protocol. kor+eng cached best_int data, sequential recognition, no confidence threshold.
Only text + scalar confidence/origin fields leave the adapter; raw blocks/bboxes/engine payload are never persisted.
PDF.js has its own render Worker (not a second OCR engine). Canvas/bitmap are released per page.

Asset/build/install, lease/reconnect, limitations and E2E instructions: ../../docs/setup/UPLOAD_RUNTIME_SETUP.md.
`next.config.ts` traces child/parser/native packages for prepare/complete and emits same-origin asset CSP.
Static /ocr paths bypass Supabase session refresh so immutable asset caching does not carry auth cookies.
No binary/language data in Git. `prepare:upload-assets` builds ignored public assets and verifies fixed language hashes.

Follow-up RPC draft `20261005093526_upload_provider_neutral_rpc.sql` is NOT applied.
Do not run new complete payloads against old remote RPC. User migration approval is required before actual ITEM E2E.
Original bucket/policies and old Migration/draft are unchanged. Whole Upload remains incomplete.
