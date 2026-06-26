// supabase/functions/_shared/safety.ts
//
// Defense-in-depth safety scrubber.
// Rules implemented
//   R1. Never ask the customer for PIN / OTP / password / full card number.
//   R2. Never confirm a refund, reversal, account unblock, or recovery.
//       Use "any eligible amount will be returned through official channels".
//   R3. Never direct the customer to a suspicious third party.


const OFFICIAL_LINE =
  "Please continue only through official support channels for any next steps.";

const SAFETY_REMINDER =
  "We never ask for your PIN, OTP, password, or full card number. " +
  "Please do not share them with anyone.";

export interface SafetyAuditResult {
  text: string;
  rewrote: boolean;
  reasons: string[];
}

const FORBIDDEN_CREDENTIAL_PATTERNS: RegExp[] = [
  // R1: any phrasing that asks for / tells the user to share a secret.
  /\bshare\s+your\s+(pin|otp|password|passcode|cvv|card\s*number)\b/i,
  /\b(?:send|provide|tell|give)\s+(?:us\s+)?(?:your\s+)?(?:pin|otp|password|passcode|cvv|card\s*number)\b/i,
  /\b(?:enter|type)\s+your\s+(pin|otp|password|passcode|cvv)\b/i,
  /\bverify\s+your\s+(pin|otp|password|passcode|cvv|card\s*number)\b/i,
];

const FORBIDDEN_REFUND_PROMISES: RegExp[] = [
  // R2: definitive "we will refund / reverse / unblock" language.
  /\bwe\s+will\s+(refund|reverse|unblock|recover|return\s+(?:the\s+)?money)\b/i,
  /\bwe\s+have\s+(refunded|reversed|unblocked|recovered)\b/i,
  /\b(?:your\s+)?(?:refund|reversal|recovery)\s+(?:is|has\s+been)\s+(?:approved|processed|completed|confirmed)\b/i,
  /\bconfirm(?:ing)?\s+(?:the\s+)?(?:refund|reversal|recovery|unblock)\b/i,
];

const FORBIDDEN_THIRD_PARTY: RegExp[] = [
  // R3: pointing the customer at non-official contact.
  /\bcontact\s+(?:our\s+)?(?:agent|number|person)\s+(?:at\s+)?\+?\d/i,
  /\bcall\s+\+?\d[\d\s\-]{6,}\b/i,
  /\bmessage\s+(?:us|me)\s+(?:on|at)\s+(?:whatsapp|telegram|signal|imo|viber|facebook|instagram)\b/i,
  /\b(?:whatsapp|telegram|signal|imo|viber)\s+(?:me|us|number)\b/i,
  /\bmeet\s+(?:at\s+)?[a-z0-9_.-]+\.(?:com|net|org|io|xyz|bd)\b/i,
];

const SAFE_REFUND_PHRASE =
  "any eligible amount will be returned through official channels after review";

/**
 * Rewrite a single phrase to its safe replacement, leaving surrounding text
 * intact. Returns the original string if no rewrite was needed.
 */
function rewrite(text: string, pattern: RegExp, replacement: string): string {
  // Replace each match; preserve capitalization heuristically.
  return text.replace(pattern, (match) => {
    if (match[0] === match[0].toUpperCase()) {
      return replacement[0].toUpperCase() + replacement.slice(1);
    }
    return replacement;
  });
}

/** Append the credential-safety reminder if the reply does not already contain one. */
function ensureSafetyReminder(text: string): string {
  const lower = text.toLowerCase();
  const already = lower.includes("pin") || lower.includes("otp") ||
    lower.includes("password") || lower.includes("card number");
  if (already) return text;
  const trimmed = text.replace(/[\s.]+$/, "");
  return `${trimmed}. ${SAFETY_REMINDER}`;
}

/**
 * Scrub a string against R1–R3.
 *
 * Returns the rewritten text plus a list of rule codes that fired. Caller
 * can decide whether to surface the `reasons` to logs (we do — they never
 * contain the original text, only the rule codes).
 */
export function scrub(text: string, rules: ("R1" | "R2" | "R3")[] = [
  "R1",
  "R2",
  "R3",
]): SafetyAuditResult {
  let out = text;
  const reasons: string[] = [];

  if (rules.includes("R1")) {
    for (const p of FORBIDDEN_CREDENTIAL_PATTERNS) {
      if (p.test(out)) {
        out = rewrite(out, p, "do not share");
        reasons.push("R1");
      }
    }
  }
  if (rules.includes("R2")) {
    for (const p of FORBIDDEN_REFUND_PROMISES) {
      if (p.test(out)) {
        out = rewrite(out, p, SAFE_REFUND_PHRASE);
        reasons.push("R2");
      }
    }
  }
  if (rules.includes("R3")) {
    for (const p of FORBIDDEN_THIRD_PARTY) {
      if (p.test(out)) {
        out = rewrite(out, p, OFFICIAL_LINE);
        reasons.push("R3");
      }
    }
  }

  // Defensive: always include the credential reminder in customer-facing text.
  if (reasons.length > 0) {
    out = ensureSafetyReminder(out);
  }

  return {
    text: out.trim(),
    rewrote: reasons.length > 0,
    reasons: Array.from(new Set(reasons)),
  };
}

/** Convenience wrapper used by the handler. */
export function auditCustomerReply(text: string): SafetyAuditResult {
  return scrub(text, ["R1", "R2", "R3"]);
}

export function auditNextAction(text: string): SafetyAuditResult {
  return scrub(text, ["R2", "R3"]);
}
