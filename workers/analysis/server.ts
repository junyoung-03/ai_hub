import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { runAnalysisBatch } from "./runner";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret || process.env.GMAIL_ANALYSIS_WORKER_ENABLED !== "true") throw new Error("WORKER_NOT_CONFIGURED");
const allowed = (process.env.GMAIL_ANALYSIS_ALLOWED_USERS ?? "").split(",").map(s=>s.trim()).filter(Boolean);
// Each DB request has a deadline; provider calls are already bounded in the shared client.
const admin = createClient<Database>(url,secret,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{
  ...init,signal:AbortSignal.any([AbortSignal.timeout(15_000),...(init?.signal ? [init.signal] : [])]),
})}});
let busy = false;
export const server = createServer(async(req,res)=>{
  res.setHeader("Content-Type","application/json"); res.setHeader("Cache-Control","no-store");
  if (req.method !== "POST" || req.url !== "/run") { res.writeHead(404).end("{}"); return; }
  // Private Cloud Run IAM is mandatory; an HTTP body never controls owner scope or credentials.
  if (req.headers["content-length"] && req.headers["content-length"] !== "0") { res.writeHead(400).end("{}"); return; }
  if (req.headers["transfer-encoding"]) { res.writeHead(400).end("{}"); return; }
  if (busy) { res.writeHead(429).end('{"error":"BUSY"}'); return; }
  busy = true;
  try { res.end(JSON.stringify(await runAnalysisBatch(admin,allowed))); }
  catch (error) {
    const safe = error instanceof Error && ["JOB_STORAGE_UNAVAILABLE","EXPLICIT_OWNER_SCOPE_REQUIRED","PROMOTIONAL_MUST_REMAIN_OFF","JOB_OWNER_MISMATCH","GEMINI_NOT_CONFIGURED"].includes(error.message) ? error.message : "WORKER_UNAVAILABLE";
    console.error(JSON.stringify({code:safe}));
    res.writeHead(503).end('{"error":"WORKER_UNAVAILABLE"}');
  }
  finally { busy = false; }
});
server.requestTimeout=300_000;
server.headersTimeout=10_000;
server.listen(Number(process.env.PORT ?? 8080),"0.0.0.0");
