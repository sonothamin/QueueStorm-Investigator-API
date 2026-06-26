// supabase/functions/_shared/http.ts
// Tiny shared HTTP utilities for QueueStorm Investigator edge functions.

export function corsHeadersFor(req: Request): Headers {
  const h = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  });
  const origin = req.headers.get("Origin");
  if (origin) h.set("Access-Control-Allow-Origin", origin);
  return h;
}

/** Respond to CORS preflight, or return null if not a preflight. */
export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeadersFor(req) });
  }
  return null;
}

/** Send a 2xx JSON response. */
export function ok(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...Object.fromEntries(corsHeadersFor(req)),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// Send a safe JSON error response.

export function httpError(
  req: Request,
  status: number,
  code: string,
  message: string,
): Response {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message } }),
    {
      status,
      headers: {
        ...Object.fromEntries(corsHeadersFor(req)),
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

/** Read JSON body safely; throws on malformed input. */
export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid_json");
  }
}

export class UpstreamError extends Error {
  readonly status: number;
  override readonly cause?: unknown;
  constructor(message: string, status = 502, cause?: unknown) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.cause = cause;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}