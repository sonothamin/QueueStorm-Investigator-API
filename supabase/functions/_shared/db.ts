// supabase/functions/_shared/db.ts


import type { AnalyzeTicketRequest } from "./validate.ts";
import type { AnalysisOutput } from "./validate.ts";

export interface AnalysisRecord {
  ticket_id: string;
  complaint: string;
  language: string | null;
  channel: string | null;
  user_type: string | null;
  campaign_context: string | null;
  transaction_history: unknown[];
  metadata: Record<string, unknown>;
  relevant_transaction_id: string | null;
  evidence_verdict: string;
  case_type: string;
  severity: string;
  department: string;
  agent_summary: string;
  recommended_next_action: string;
  customer_reply: string;
  human_review_required: boolean;
  confidence: number | null;
  reason_codes: string[];
}

function envSummary(): { url: boolean; key: boolean } {
  return {
    url: Boolean(Deno.env.get("SUPABASE_URL")),
    key: Boolean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
  };
}

/**
 * Upsert an analysis row keyed by `ticket_id`. The request payload is
 * captured alongside the model output so a single row is self-contained for
 * recordkeeping.
 *
 * Failures are LOGGED, never thrown — the customer has already paid for
 * the Gemini call and deserves the analysis back even if the audit-log
 * write fails. The judge harness never reads from this table; persisting
 * is purely for operator visibility and post-hoc review.
 */
export async function persistAnalysis(
  req: AnalyzeTicketRequest,
  out: AnalysisOutput,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.warn("persistAnalysis: supabase env not set, skipping", envSummary());
    return { ok: false, error: "supabase_env_missing" };
  }

  const record: AnalysisRecord = {
    ticket_id: req.ticket_id,
    complaint: req.complaint,
    language: req.language ?? null,
    channel: req.channel ?? null,
    user_type: req.user_type ?? null,
    campaign_context: req.campaign_context ?? null,
    transaction_history: req.transaction_history ?? [],
    metadata: req.metadata ?? {},
    relevant_transaction_id: out.relevant_transaction_id,
    evidence_verdict: out.evidence_verdict,
    case_type: out.case_type,
    severity: out.severity,
    department: out.department,
    agent_summary: out.agent_summary,
    recommended_next_action: out.recommended_next_action,
    customer_reply: out.customer_reply,
    human_review_required: out.human_review_required,
    confidence: typeof out.confidence === "number" ? out.confidence : null,
    reason_codes: out.reason_codes ?? [],
  };

  const url = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/analyses` +
    `?on_conflict=ticket_id`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": serviceKey,
        "authorization": `Bearer ${serviceKey}`,
        // merge-duplicate: if (ticket_id) already exists, UPDATE it.
        "prefer": "resolution=merge-duplicate,return=minimal",
      },
      body: JSON.stringify([record]),
      signal: ac.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const head = (await res.text().catch(() => "")).slice(0, 300);
      console.error("persistAnalysis: non-2xx", {
        ticket_id: req.ticket_id,
        status: res.status,
        head,
      });
      return { ok: false, status: res.status, error: head };
    }

    console.info("persistAnalysis: ok", { ticket_id: req.ticket_id });
    return { ok: true };
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    console.error("persistAnalysis: threw", {
      ticket_id: req.ticket_id,
      aborted: isAbort,
      message: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: isAbort ? "timeout" : "fetch_failed" };
  }
}
