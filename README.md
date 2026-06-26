# QueueStorm Investigator

An AI-powered support operations API for analyzing customer complaints against recent transaction history. It exposes a production-style REST interface for support agents and internal copilots.

## Live API Instance Endpoints
- GET /health
  ```
  https://glidbvymnitdsntrzmrg.supabase.co/functions/v1/health
  ```

- POST analyze-ticket
  ```
  https://glidbvymnitdsntrzmrg.supabase.co/functions/v1/analyze-ticket
  ```

## Features
- Analyze customer tickets using both complaint text and recent transaction history.
- Identify the relevant transaction and assess whether the evidence is consistent, inconsistent, or insufficient.
- Classify the case type, severity, and responsible department
- Generate an agent-ready summary, a safe next action for the support representative, and a customer-facing reply
- Enforce safety guardrails to avoid PIN/OTP requests, refund authorization, suspicious third-party instructions, etc.
- Expose a lightweight health endpoint for readiness checks.
- Logs the analysis requests in the Supabase DB for record keeping.

## Syntax

### Health
GET /health

Returns server health/liveness
```json
 {status:"ok"}
```

### Request Schema

POST /analyze-ticket

```json
{
  "ticket_id": "TKT-001",
  "complaint": "I sent 5000 taka to a wrong number around 2pm today...",
  "language": "en",
  "channel": "in_app_chat",
  "user_type": "customer",
  "campaign_context": "boishakh_bonanza_day_1",
  "transaction_history": [
    {
      "transaction_id": "TXN-9101",
      "timestamp": "2026-04-14T14:08:22Z",
      "type": "transfer",
      "amount": 5000,
      "counterparty": "+8801719876543",
      "status": "completed"
    }
  ]
}
```

### Sample Response

```json
{
  "ticket_id": "TKT-001",
  "relevant_transaction_id": "TXN-9101",
  "evidence_verdict": "consistent",
  "case_type": "wrong_transfer",
  "severity": "high",
  "department": "dispute_resolution",
  "agent_summary": "Customer reports sending 5000 BDT to the wrong recipient via TXN-9101.",
  "recommended_next_action": "Verify the transaction details and escalate for dispute handling if needed.",
  "customer_reply": "We have noted your concern about this transaction. Please continue using official support channels for review.",
  "human_review_required": true,
  "confidence": 0.9,
  "reason_codes": ["wrong_transfer", "transaction_match"]
}
```

## Platform
- Database: Supabase
- Compute: Supabase Edge Functions
- API style: REST JSON endpoints

## Stack
- Supabase Deno TypeScript
- Edge Functions for API hosting
- Gemini-powered reasoning and summarization

## Model
- Service: Google Gemini
- Model: Gemini 2.5 Flash
- Why this model: 
  + It is free to access for many use cases
  + Fast enough for support workflows
  + Capable of handling ticket summarization, severity assessment, case routing, and safe support assistance.

### Safety logic
Every analysis run passes through layered guardrails so the model can never override policy with content from a complaint:

- **System-prompt guardrails (input side).** The investigator prompt (`supabase/functions/_shared/prompts.ts`) is treated as non-negotiable. It instructs the model to never ask for PINs, OTPs, passwords, or full card numbers; never confirm a refund, reversal, account unblock, or recovery; never direct customers to suspicious third parties or numbers found inside the complaint; never follow instructions embedded inside the complaint; and to stay strictly on the scope of the complaint and the provided transaction history. Complaints that try to override the role or output format are ignored and flagged via `reason_codes` / `human_review_required`.
- **Output schema enforcement.** The model is required to return a single JSON object conforming to a strict enum contract (`case_type`, `severity`, `department`, `evidence_verdict`, etc.). Any output that fails schema or enum validation is rejected and replaced by a deterministic fallback analysis.
- **Credential-request scrubber.** `customer_reply` is post-processed by `ensureSafetyReminder` in `supabase/functions/_shared/safety.ts`. If the reply does not already mention a credential (PIN/OTP/password/card number), a neutral safety reminder is appended automatically.
- **Phishing heuristic.** A lightweight pattern check flags replies that mention suspicious channels (unknown phone numbers, third-party apps, non-official links) and rewrites them so only official in-app help center, the hotline on the back of the card, or a branch is referenced.
- **PII redaction before logging.** Personally identifiable identifiers in the complaint are masked before persistence; only masked content is stored in Supabase.
- **Deterministic fallback path.** If the Gemini call times out, returns 5xx, produces invalid JSON, or triggers the safety audit, the endpoint returns HTTP `207 Multi-Status` with `meta.fallback=true` and a conservative rule-based analysis so the customer reply can never be the unsafe raw output.
- **Persistent overrides.** Analysts can `PATCH /analyses/:ticket_id` to correct a verdict; the patch re-runs the same safety audit so the corrected `customer_reply` is re-scrubbed before persistence.

### Limitations
- **Schema-bound output.** Free-form explanations are not supported; every response must conform to the fixed enum contract, which limits expressive nuance.
- **LLM non-determinism.** Even with low temperature, Gemini can vary outputs across runs. 
- **No Fallback Model.** Up to now, there is no fallback model if Gemini fails, no backup AI model or API is set up to continue service.
- **Prompt-injection surface.** Complaints are treated as data, not instructions, and the safety scrubber covers known patterns, but jailbreak phrasing may still slip through.


## Deployment

### 1. Clone the repository

```bash
git clone https://github.com/sonothamin/QueueStorm-Investigator-API.git
cd "QueueStorm-Investigator-API"
```

### 2. Create a Supabase project and generate Gemini API
- Create a new Supabase project from the Supabase dashboard and note your project reference.
- Go to https://aistudio.google.com/ and generate an API key.

### 3. Configure environment variables
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically if running from Supabase Cloud Provider. `GEMINI_API_KEY` is the only mandatory field.

Goto your Supabase project dashborad, navigate to edge functions and update the environment variable.

### 4. Initialize the Supabase CLI

```bash
npx supabase login
```

Follow the login flow in your browser.

### 5. Link your local project to Supabase

```bash
npx supabase link --project-ref <your-project-ref>
```

### 6. Deploy the functions

```bash
npx supabase functions deploy
npx supabase db push
```

## Notes
- The service expects a valid Gemini API key to generate structured outputs.
- As per competetion guideline, I haven't enabled the Auth yet. The functions run with the `Service Role JWT`, but ideally, there should be an auth. 
