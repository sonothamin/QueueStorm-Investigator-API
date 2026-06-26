// supabase/functions/analyze-ticket/index.ts
//
//   POST /analyze-ticket — the core QueueStorm Investigator endpoint.
//
//   Pipeline:
//     1. CORS + method check.
//     2. Parse + validate the JSON body server-side.
//     3. Build a strict prompt (system instruction + fenced user message).
//     4. Call Gemini with responseMimeType=application/json + a schema,
//        retries on 429/5xx, hard timeout via AbortController.
//     5. Run the response through a server-side safety scrubber so a model
//        that drifts off-policy cannot leak a forbidden phrase.
//     6. Return the cleaned JSON exactly per Section 6.

import { corsHeadersFor, handleCors, httpError, ok, readJson, UpstreamError } from "../_shared/http.ts";
import { getConfig } from "../_shared/config.ts";
import { callGemini } from "../_shared/gemini.ts";
import {
  auditCustomerReply,
  auditNextAction,
} from "../_shared/safety.ts";
import {
  parseAnalyzeTicketRequest,
  ValidationError,
} from "../_shared/validate.ts";
import { persistAnalysis } from "../_shared/db.ts";

function handler(req: Request): Promise<Response> | Response {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: "method_not_allowed", message: "Use POST" },
      }),
      { status: 405, headers: corsHeadersFor(req) },
    );
  }

  return handle(req);
}

async function handle(req: Request): Promise<Response> {
  try {
    getConfig();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("analyze-ticket: config missing", { msg });
    const message = /GEMINI_API_KEY/.test(msg)
      ? "Service is not configured: GEMINI_API_KEY is missing. Set the secret and redeploy."
      : "Service is warming up and is temporarily unavailable. Please retry shortly.";
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "not_ready",
          message,
          cause: msg,
          retryable: true,
        },
      }),
      {
        status: 503,
        headers: {
          ...Object.fromEntries(corsHeadersFor(req)),
          "Content-Type": "application/json; charset=utf-8",
          "Retry-After": "10",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  // Parse + validate body.
  let parsedReq;
  try {
    const raw = await readJson(req);
    parsedReq = parseAnalyzeTicketRequest(raw);
  } catch (err) {
    if (err instanceof ValidationError) {
      return httpError(req, err.status, err.code, err.message);
    }
    if (err instanceof Error && err.message === "invalid_json") {
      return httpError(req, 400, "invalid_json", "Request body is not valid JSON");
    }
    console.error("analyze-ticket: unexpected parse error", err);
    return httpError(req, 400, "bad_request", "Could not parse request");
  }
 //Log
  console.info("analyze-ticket: request received", {
    ticket_id: parsedReq.ticket_id,
    language: parsedReq.language ?? null,
    channel: parsedReq.channel ?? null,
    user_type: parsedReq.user_type ?? null,
    txn_count: parsedReq.transaction_history?.length ?? 0,
  });

  // Call Gemini.
  let analysis;
  try {
    analysis = await callGemini(parsedReq);
  } catch (err) {
    if (err instanceof UpstreamError) {
      const message = err.message;
      if (message.startsWith("upstream_blocked:")) {
        const reason = message.slice("upstream_blocked:".length);
        console.warn("analyze-ticket: upstream blocked content", {
          ticket_id: parsedReq.ticket_id,
          reason,
        });
        return httpError(
          req,
          422,
          "upstream_blocked",
          `Request rejected by the upstream safety filter (${reason}). ` +
            `Reframe the complaint or strip sensitive identifiers and retry.`,
        );
      }
      if (message === "upstream_truncated") {
        console.error("analyze-ticket: upstream output truncated", {
          ticket_id: parsedReq.ticket_id,
        });
        return httpError(
          req,
          502,
          "upstream_truncated",
          "Upstream model ran out of output tokens before completing the " +
            "JSON response. Please retry with a shorter complaint or fewer " +
            "transactions in the history.",
        );
      }
      const map: Record<number, string> = {
        429: "rate_limited",
        502: "upstream_error",
        503: "upstream_unavailable",
        504: "upstream_timeout",
      };
      const code = map[err.status] ?? "upstream_error";
      console.error("analyze-ticket: upstream failure", {
        ticket_id: parsedReq.ticket_id,
        status: err.status,
        code,
        upstream_message: message,
      });
      const friendly = err.status === 429
        ? "Upstream rate limit reached. Please retry after a short backoff."
        : err.status === 504
        ? "Upstream model timed out. Please retry."
        : "Upstream model failed. Please retry.";
      return httpError(req, err.status, code, friendly);
    }
    console.error("analyze-ticket: unexpected gemini error", err);
    return httpError(req, 500, "internal_error", "Unexpected server error");
  }

  // Server-side safety scrubber. 
  // The model was already told to obey these rules, but we do not trust it.
  // Who trusts AIs right? XD
  const replyAudit = auditCustomerReply(analysis.customer_reply);
  const nextActionAudit = auditNextAction(analysis.recommended_next_action);

  if (replyAudit.rewrote || nextActionAudit.rewrote) {
    console.warn("analyze-ticket: safety scrubber rewrote output", {
      ticket_id: parsedReq.ticket_id,
      reply_rules: replyAudit.reasons,
      next_action_rules: nextActionAudit.reasons,
    });
  }

  const cleaned = {
    ...analysis,
    ticket_id: parsedReq.ticket_id,
    customer_reply: replyAudit.text,
    recommended_next_action: nextActionAudit.text,
  };

  await persistAnalysis(parsedReq, cleaned);

  return ok(req, cleaned, 200);
}

// Local dev entrypoint
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

if (import.meta.main) {
  serve(handler, { port: Number(Deno.env.get("PORT") ?? 8000) });
}

export { handler };