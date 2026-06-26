// supabase/functions/health/index.ts
// GET /health — liveness/readiness probe for the QueueStorm Investigator API.


import { corsHeadersFor, handleCors, httpError, ok } from "../_shared/http.ts";

function runtimeReady(): { ready: boolean; missing: string[] } {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missing = required.filter((k) => !Deno.env.get(k));
  return { ready: missing.length === 0, missing };
}

function handler(req: Request): Response {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "GET") {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: "method_not_allowed", message: "Use GET" },
      }),
      { status: 405, headers: corsHeadersFor(req) },
    );
  }

  const { ready, missing } = runtimeReady();
  if (!ready) {
    console.error("health: runtime not ready", { missing });
    return httpError(req, 503, "not_ready", "Service warming up");
  }

  return ok(req, { status: "ok" }, 200);
}

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

if (import.meta.main) {
  serve(handler, { port: Number(Deno.env.get("PORT") ?? 8000) });
}

export { handler };