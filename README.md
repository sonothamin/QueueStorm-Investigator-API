# QueueStorm Investigator

An AI-powered support operations API for analyzing customer complaints against recent transaction history. It exposes a production-style REST interface for support agents and internal copilots.

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
