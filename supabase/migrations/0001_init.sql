-- ============================================================================
-- QueueStorm Investigator — initial schema (idempotent reset)
-- Task spec: Sections 5 (Request Schema), 6 (Response Schema), 7 (Enums)
--
-- This script DROPS the prior tables if they exist and recreates them from
-- scratch, so it can be re-applied against a database that already has the
-- old schema. Transaction history is no longer persisted: callers send it
-- inline with each request, so the `transactions` table is intentionally
-- omitted. `analyses.relevant_transaction_id` is therefore a free-form text.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Drop existing objects (reverse dependency order)
-- ---------------------------------------------------------------------------
drop table if exists public.analyses     cascade;
drop table if exists public.transactions cascade;
drop table if exists public.tickets      cascade;

drop type if exists department_kind;
drop type if exists severity_level;
drop type if exists case_type;
drop type if exists evidence_verdict;
drop type if exists transaction_status;
drop type if exists transaction_kind;
drop type if exists user_type_kind;
drop type if exists ticket_channel;
drop type if exists language_code;

-- ---------------------------------------------------------------------------
-- Enums (Section 7)
-- ---------------------------------------------------------------------------

-- language (Section 5.1)
do $$ begin
  create type language_code as enum ('en', 'bn', 'mixed');
exception when duplicate_object then null; end $$;

-- channel (Section 5.1)
do $$ begin
  create type ticket_channel as enum (
    'in_app_chat', 'call_center', 'email', 'merchant_portal', 'field_agent'
  );
exception when duplicate_object then null; end $$;

-- user_type (Section 5.1)
do $$ begin
  create type user_type_kind as enum ('customer', 'merchant', 'agent', 'unknown');
exception when duplicate_object then null; end $$;

-- transaction.type (Section 5.2)
do $$ begin
  create type transaction_kind as enum (
    'transfer', 'payment', 'cash_in', 'cash_out', 'settlement', 'refund'
  );
exception when duplicate_object then null; end $$;

-- transaction.status (Section 5.2)
do $$ begin
  create type transaction_status as enum (
    'completed', 'failed', 'pending', 'reversed'
  );
exception when duplicate_object then null; end $$;

-- evidence_verdict (Section 3 / 6.1)
do $$ begin
  create type evidence_verdict as enum (
    'consistent', 'inconsistent', 'insufficient_data'
  );
exception when duplicate_object then null; end $$;

-- case_type (Section 7.1)
do $$ begin
  create type case_type as enum (
    'wrong_transfer',
    'payment_failed',
    'refund_request',
    'duplicate_payment',
    'merchant_settlement_delay',
    'agent_cash_in_issue',
    'phishing_or_social_engineering',
    'other'
  );
exception when duplicate_object then null; end $$;

-- severity (Section 6.1)
do $$ begin
  create type severity_level as enum ('low', 'medium', 'high', 'critical');
exception when duplicate_object then null; end $$;

-- department (Section 7.2)
do $$ begin
  create type department_kind as enum (
    'customer_support',
    'dispute_resolution',
    'payments_ops',
    'merchant_operations',
    'agent_operations',
    'fraud_risk'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Inbound tickets as received by POST /analyze-ticket (Section 5)
create table if not exists public.tickets (
  id                uuid primary key default gen_random_uuid(),
  ticket_id         text unique not null,
  complaint         text not null check (char_length(complaint) > 0),
  language          language_code,
  channel           ticket_channel,
  user_type         user_type_kind,
  campaign_context  text,
  metadata          jsonb not null default '{}'::jsonb,
  received_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index if not exists tickets_received_at_idx
  on public.tickets (received_at desc);
create index if not exists tickets_campaign_idx
  on public.tickets (campaign_context);

-- Transaction history snippets are NOT persisted: callers pass them inline
-- with each request, so the `transactions` table is intentionally omitted.
-- `relevant_transaction_id` is therefore a free-form identifier (no FK).

-- Analyses produced by the investigator (Section 6)
create table if not exists public.analyses (
  id                          uuid primary key default gen_random_uuid(),
  ticket_id                   text unique not null references public.tickets(ticket_id) on delete cascade,
  relevant_transaction_id     text,
  evidence_verdict            evidence_verdict not null,
  case_type                   case_type not null,
  severity                    severity_level not null,
  department                  department_kind not null,
  agent_summary               text not null,
  recommended_next_action     text not null,
  customer_reply              text not null,
  human_review_required       boolean not null,
  confidence                  numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  reason_codes                text[] not null default '{}',
  created_at                  timestamptz not null default now()
);

create index if not exists analyses_department_idx
  on public.analyses (department);
create index if not exists analyses_case_type_idx
  on public.analyses (case_type);
create index if not exists analyses_severity_idx
  on public.analyses (severity);
create index if not exists analyses_human_review_idx
  on public.analyses (human_review_required)
  where human_review_required;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.tickets      enable row level security;
alter table public.analyses     enable row level security;

drop policy if exists "service role full access on tickets"      on public.tickets;
drop policy if exists "service role full access on analyses"     on public.analyses;

create policy "service role full access on tickets"
  on public.tickets for all to service_role using (true) with check (true);
create policy "service role full access on analyses"
  on public.analyses for all to service_role using (true) with check (true);