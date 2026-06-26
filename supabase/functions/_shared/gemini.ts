// supabase/functions/_shared/gemini.ts
// Minimal Gemini REST client used by /analyze-ticket.

import { getConfig } from "./config.ts";
import { sleep, UpstreamError } from "./http.ts";
import { buildResponseJsonSchema, buildUserPrompt, SYSTEM_INSTRUCTION } from "./prompts.ts";
import type { AnalyzeTicketRequest, AnalysisOutput } from "./validate.ts";
import { parseAnalysisOutput } from "./validate.ts";

export interface GeminiCallOptions {
  signal?: AbortSignal;
}

interface GeminiPart {
  text?: string;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiRequest {
  systemInstruction: { parts: GeminiPart[] };
  contents: GeminiContent[];
  generationConfig: {
    temperature: number;
    topP: number;
    maxOutputTokens: number;
    responseMimeType: "application/json";
    responseSchema: Record<string, unknown>;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Call Gemini and return the parsed AnalysisOutput.
 *
 * Throws UpstreamError with a sanitised message; never echoes the API key
 * or the raw response body.
 */

export async function callGemini(
  req: AnalyzeTicketRequest,
  opts: GeminiCallOptions = {},
): Promise<AnalysisOutput> {
  const cfg = getConfig();
  const userPrompt = buildUserPrompt(req, cfg);

  const body: GeminiRequest = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    generationConfig: {
        temperature: 0.1,
        topP: 0.9,
        maxOutputTokens: 4092,
        responseMimeType: "application/json",
        responseSchema: buildResponseJsonSchema(),
      },
  };

  const url = `${cfg.geminiEndpoint}?key=${encodeURIComponent(cfg.geminiApiKey)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.requestTimeoutMs);
  opts.signal?.addEventListener("abort", () => ac.abort());

  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ac.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        lastErr = new Error(`HTTP ${res.status}`);
        // Log enough to debug without flooding the log; never the API key.
        const head = errText.slice(0, 300);
        const tail = errText.length > 300 ? errText.slice(-300) : "";
        console.error("gemini non-2xx", {
          ticket_id: req.ticket_id,
          status: res.status,
          attempt,
          bodyLen: errText.length,
          head,
          tail,
          body: errText,
        });
        if (isRetryable(res.status) && attempt < cfg.maxRetries) {
          await sleep(200 * 2 ** attempt + Math.random() * 100);
          continue;
        }
        // Map common cases to safe status codes for the client.
        const status = res.status === 429
          ? 429
          : res.status === 400
          ? 502
          : 502;
        throw new UpstreamError(
          `upstream_${status === 429 ? "rate_limited" : "error"}`,
          status,
        );
      }

      const data = (await res.json()) as GeminiResponse;
      const candidate = data.candidates?.[0];
      const blockReason = data.promptFeedback?.blockReason;
      const finishReason = candidate?.finishReason;
      if (blockReason || finishReason === "SAFETY") {
        const reason = blockReason ?? finishReason ?? "SAFETY";
        console.warn("gemini blocked by safety filter", {
          ticket_id: req.ticket_id,
          blockReason: reason,
        });
        throw new UpstreamError(
          `upstream_blocked:${reason}`,
          422,
        );
      }

      const text = candidate?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim();

      if (!text) {
        console.error("gemini empty response", {
          ticket_id: req.ticket_id,
          finish_reason: finishReason ?? null,
          block_reason: blockReason ?? null,
          raw: data,
        });
        throw new UpstreamError("upstream_empty_response", 502);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        // Distinguish MAX_TOKENS truncation from genuine malformed output.
    
        const truncated = finishReason === "MAX_TOKENS" ||
          (text.length > 0 && !text.trimEnd().endsWith("}"));
        console.error("gemini returned non-JSON", {
          ticket_id: req.ticket_id,
          text_len: text.length,
          head: text.slice(0, 200),
          tail: text.length > 80 ? text.slice(-80) : "",
          text,
          finish_reason: finishReason ?? null,
          likely_truncated: truncated,
          parse_error: e instanceof Error ? e.message : String(e),
        });
        if (truncated) {
          throw new UpstreamError("upstream_truncated", 502, e);
        }
        throw new UpstreamError("upstream_invalid_json", 502, e);
      }

      return parseAnalysisOutput(parsed, req.ticket_id);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new UpstreamError("upstream_timeout", 504, err);
      }
      if (err instanceof UpstreamError) throw err;
      lastErr = err;
      if (attempt < cfg.maxRetries) {
        await sleep(200 * 2 ** attempt + Math.random() * 100);
        continue;
      }
    }
  }

  throw new UpstreamError("upstream_exhausted_retries", 502, lastErr);
}
