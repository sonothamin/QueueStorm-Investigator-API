// supabase/functions/_shared/validate.ts
// Server-side validation for /analyze-ticket.


export type Language = "en" | "bn" | "mixed";
export type Channel =
  | "in_app_chat"
  | "call_center"
  | "email"
  | "merchant_portal"
  | "field_agent";
export type UserType = "customer" | "merchant" | "agent" | "unknown";
export type TxnType =
  | "transfer"
  | "payment"
  | "cash_in"
  | "cash_out"
  | "settlement"
  | "refund";
export type TxnStatus = "completed" | "failed" | "pending" | "reversed";

export interface TxnHistoryEntry {
  transaction_id: string;
  timestamp: string; // ISO 8601
  type: TxnType;
  amount: number;
  counterparty: string;
  status: TxnStatus;
}

export interface AnalyzeTicketRequest {
  ticket_id: string;
  complaint: string;
  language?: Language;
  channel?: Channel;
  user_type?: UserType;
  campaign_context?: string;
  transaction_history?: TxnHistoryEntry[];
  metadata?: Record<string, unknown>;
}

const LANGUAGES: ReadonlySet<string> = new Set(["en", "bn", "mixed"]);
const CHANNELS: ReadonlySet<string> = new Set([
  "in_app_chat",
  "call_center",
  "email",
  "merchant_portal",
  "field_agent",
]);
const USER_TYPES: ReadonlySet<string> = new Set([
  "customer",
  "merchant",
  "agent",
  "unknown",
]);
const TXN_TYPES: ReadonlySet<string> = new Set([
  "transfer",
  "payment",
  "cash_in",
  "cash_out",
  "settlement",
  "refund",
]);
const TXN_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "pending",
  "reversed",
]);

export class ValidationError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.status = status;
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function clampComplaint(raw: string): string {
  // 8 KB cap: enough for real complaints, kills prompt-inflation attempts.
  const MAX = 8 * 1024;
  return raw.length > MAX ? raw.slice(0, MAX) : raw;
}

export function parseAnalyzeTicketRequest(raw: unknown): AnalyzeTicketRequest {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("bad_shape", "Request body must be a JSON object");
  }
  const r = raw as Record<string, unknown>;

  const ticket_id = asString(r.ticket_id)?.trim();
  const complaint = asString(r.complaint)?.trim();
  if (!ticket_id) {
    throw new ValidationError("missing_ticket_id", "ticket_id is required");
  }
  if (!complaint) {
    throw new ValidationError(
      "missing_complaint",
      "complaint is required and must be non-empty",
      422,
    );
  }

  const language = asString(r.language);
  if (language !== undefined && !LANGUAGES.has(language)) {
    throw new ValidationError("bad_language", `unknown language: ${language}`);
  }

  const channel = asString(r.channel);
  if (channel !== undefined && !CHANNELS.has(channel)) {
    throw new ValidationError("bad_channel", `unknown channel: ${channel}`);
  }

  const user_type = asString(r.user_type);
  if (user_type !== undefined && !USER_TYPES.has(user_type)) {
    throw new ValidationError("bad_user_type", `unknown user_type: ${user_type}`);
  }

  let transaction_history: TxnHistoryEntry[] | undefined;
  if (r.transaction_history !== undefined) {
    if (!Array.isArray(r.transaction_history)) {
      throw new ValidationError(
        "bad_transaction_history",
        "transaction_history must be an array",
      );
    }
    if (r.transaction_history.length > 20) {
      throw new ValidationError(
        "transaction_history_too_large",
        "transaction_history exceeds 20 entries",
      );
    }
    transaction_history = r.transaction_history.map((entry, i) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new ValidationError(
          "bad_transaction_entry",
          `transaction_history[${i}] must be an object`,
        );
      }
      const e = entry as Record<string, unknown>;
      const transaction_id = asString(e.transaction_id)?.trim();
      const timestamp = asString(e.timestamp)?.trim();
      const type = asString(e.type);
      const amount = asNumber(e.amount);
      const counterparty = asString(e.counterparty)?.trim();
      const status = asString(e.status);
      if (!transaction_id) {
        throw new ValidationError(
          "bad_transaction_entry",
          `transaction_history[${i}].transaction_id required`,
        );
      }
      if (!timestamp) {
        throw new ValidationError(
          "bad_transaction_entry",
          `transaction_history[${i}].timestamp required`,
        );
      }
      if (!type || !TXN_TYPES.has(type)) {
        throw new ValidationError(
          "bad_transaction_entry",
          `transaction_history[${i}].type invalid`,
        );
      }
      if (amount === undefined || amount < 0) {
        throw new ValidationError(
          "bad_transaction_entry",
          `transaction_history[${i}].amount must be a non-negative number`,
        );
      }
      if (!counterparty) {
        throw new ValidationError(
          "bad_transaction_entry",
          `transaction_history[${i}].counterparty required`,
        );
      }
      if (!status || !TXN_STATUSES.has(status)) {
        throw new ValidationError(
          "bad_transaction_entry",
          `transaction_history[${i}].status invalid`,
        );
      }
      return {
        transaction_id,
        timestamp,
        type: type as TxnType,
        amount,
        counterparty,
        status: status as TxnStatus,
      };
    });
  }

  let metadata: Record<string, unknown> | undefined;
  if (r.metadata !== undefined) {
    if (
      r.metadata === null || typeof r.metadata !== "object" ||
      Array.isArray(r.metadata)
    ) {
      throw new ValidationError("bad_metadata", "metadata must be an object");
    }
    metadata = r.metadata as Record<string, unknown>;
  }

  const campaign_context = asString(r.campaign_context)?.trim();

  return {
    ticket_id,
    complaint: clampComplaint(complaint),
    language: language as Language | undefined,
    channel: channel as Channel | undefined,
    user_type: user_type as UserType | undefined,
    campaign_context,
    transaction_history,
    metadata,
  };
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

export type EvidenceVerdict = "consistent" | "inconsistent" | "insufficient_data";

export const CASE_TYPES = [
  "wrong_transfer",
  "payment_failed",
  "refund_request",
  "duplicate_payment",
  "merchant_settlement_delay",
  "agent_cash_in_issue",
  "phishing_or_social_engineering",
  "other",
] as const;
export type CaseType = typeof CASE_TYPES[number];

export const DEPARTMENTS = [
  "customer_support",
  "dispute_resolution",
  "payments_ops",
  "merchant_operations",
  "agent_operations",
  "fraud_risk",
] as const;
export type Department = typeof DEPARTMENTS[number];

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type Severity = typeof SEVERITIES[number];

export const VERDICTS: ReadonlySet<string> = new Set([
  "consistent",
  "inconsistent",
  "insufficient_data",
]);

export interface AnalysisOutput {
  ticket_id: string;
  relevant_transaction_id: string | null;
  evidence_verdict: EvidenceVerdict;
  case_type: CaseType;
  severity: Severity;
  department: Department;
  agent_summary: string;
  recommended_next_action: string;
  customer_reply: string;
  human_review_required: boolean;
  confidence?: number;
  reason_codes?: string[];
}

export function parseAnalysisOutput(
  raw: unknown,
  expectedTicketId: string,
): AnalysisOutput {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("bad_model_output", "Model output is not an object");
  }
  const r = raw as Record<string, unknown>;

  const ticket_id = asString(r.ticket_id)?.trim() ?? expectedTicketId;

  const relevant_transaction_id = r.relevant_transaction_id === null
    ? null
    : asString(r.relevant_transaction_id)?.trim() ?? null;

  const evidence_verdict = asString(r.evidence_verdict);
  if (!evidence_verdict || !VERDICTS.has(evidence_verdict)) {
    throw new ValidationError(
      "bad_evidence_verdict",
      `evidence_verdict must be one of: ${[...VERDICTS].join(", ")}`,
    );
  }

  const case_type = asString(r.case_type);
  if (!case_type || !(CASE_TYPES as readonly string[]).includes(case_type)) {
    throw new ValidationError(
      "bad_case_type",
      `case_type must be one of: ${CASE_TYPES.join(", ")}`,
    );
  }

  const severity = asString(r.severity);
  if (!severity || !(SEVERITIES as readonly string[]).includes(severity)) {
    throw new ValidationError(
      "bad_severity",
      `severity must be one of: ${SEVERITIES.join(", ")}`,
    );
  }

  const department = asString(r.department);
  if (!department || !(DEPARTMENTS as readonly string[]).includes(department)) {
    throw new ValidationError(
      "bad_department",
      `department must be one of: ${DEPARTMENTS.join(", ")}`,
    );
  }

  const agent_summary = asString(r.agent_summary)?.trim();
  const recommended_next_action = asString(r.recommended_next_action)?.trim();
  const customer_reply = asString(r.customer_reply)?.trim();

  if (!agent_summary) {
    throw new ValidationError("missing_agent_summary", "agent_summary required");
  }
  if (!recommended_next_action) {
    throw new ValidationError(
      "missing_recommended_next_action",
      "recommended_next_action required",
    );
  }
  if (!customer_reply) {
    throw new ValidationError(
      "missing_customer_reply",
      "customer_reply required",
    );
  }

  let human_review_required: boolean;
  if (typeof r.human_review_required === "boolean") {
    human_review_required = r.human_review_required;
  } else {
    // Conservative default: anything ambiguous must be reviewed by a human.
    human_review_required = true;
  }

  let confidence: number | undefined;
  if (r.confidence !== undefined && r.confidence !== null) {
    const n = asNumber(r.confidence);
    if (n === undefined || n < 0 || n > 1) {
      throw new ValidationError("bad_confidence", "confidence must be in [0,1]");
    }
    confidence = n;
  }

  let reason_codes: string[] | undefined;
  if (r.reason_codes !== undefined && r.reason_codes !== null) {
    if (!Array.isArray(r.reason_codes)) {
      throw new ValidationError(
        "bad_reason_codes",
        "reason_codes must be an array of strings",
      );
    }
    reason_codes = r.reason_codes
      .map((c) => asString(c))
      .filter((c): c is string => Boolean(c));
  }

  return {
    ticket_id,
    relevant_transaction_id,
    evidence_verdict: evidence_verdict as EvidenceVerdict,
    case_type: case_type as CaseType,
    severity: severity as Severity,
    department: department as Department,
    agent_summary,
    recommended_next_action,
    customer_reply,
    human_review_required,
    confidence,
    reason_codes,
  };
}
