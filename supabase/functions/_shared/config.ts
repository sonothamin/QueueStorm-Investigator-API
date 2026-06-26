// supabase/functions/_shared/config.ts

export interface AppConfig {
  
  geminiApiKey: string;
  geminiModel: string;  
  geminiEndpoint: string;
  requestTimeoutMs: number;
  maxRetries: number;
  serviceName: string;
  promptVersion: string;
}

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;

  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const geminiModel = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";

  const endpointBase = Deno.env.get("GEMINI_ENDPOINT") ??
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`;

  cached = {
    geminiApiKey,
    geminiModel,
    geminiEndpoint: endpointBase,
    requestTimeoutMs: Number(Deno.env.get("REQUEST_TIMEOUT_MS") ?? 24_000),
    maxRetries: Number(Deno.env.get("MAX_RETRIES") ?? 2),
    serviceName: Deno.env.get("SERVICE_NAME") ?? "queuestorm-investigator",
    promptVersion: Deno.env.get("PROMPT_VERSION") ?? "2026-06-26.v1",
  };
  return cached;
}

/** Lightweight env summary, safe to expose on /health. */
export function envSummary(): Record<string, unknown> {
  const c = cached ?? getConfig();
  return {
    model: c.geminiModel,
    prompt_version: c.promptVersion,
    request_timeout_ms: c.requestTimeoutMs,
  };
}

/** Test-only hook. */
export function _resetConfigForTests(): void {
  cached = null;
}
