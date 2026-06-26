-- ============================================================================
-- QueueStorm Investigator — initial schema 
-- ============================================================================

create extension if not exists "pgcrypto";

drop table if exists public.analyses     cascade;

-- language
do $$ begin
  create type language_code as enum ('en', 'bn', 'mixed');
exception when duplicate_object then null; end $$;

-- channel
do $$ begin
  create type ticket_channel as enum (
    'in_app_chat', 'call_center', 'email', 'merchant_portal', 'field_agent'
  );
exception when duplicate_object then null; end $$;

-- user_type
do $$ begin
  create type user_type_kind as enum ('customer', 'merchant', 'agent', 'unknown');
exception when duplicate_object then null; end $$;

-- evidence_verdict
do $$ begin
  create type evidence_verdict as enum (
    'consistent', 'inconsistent', 'insufficient_data'
  );
exception when duplicate_object then null; end $$;

-- case_type
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

-- severity
do $$ begin
  create type severity_level as enum ('low', 'medium', 'high', 'critical');
exception when duplicate_object then null; end $$;

-- department
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

create table if not exists public.analyses (
  --userpart
  id                          uuid primary key default gen_random_uuid(),
  ticket_id                   text unique not null,
  complaint                   text not null check (char_length(complaint) > 0),
  language                    language_code,
  channel                     ticket_channel,
  user_type                   user_type_kind,
  campaign_context            text,
  transaction_history         jsonb not null default '[]'::jsonb,
  metadata                    jsonb not null default '{}'::jsonb,

  --agent part
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

  -- records.
  received_at                 timestamptz not null default now(),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
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
create index if not exists analyses_received_at_idx
  on public.analyses (received_at desc);


create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists analyses_set_updated_at on public.analyses;
create trigger analyses_set_updated_at
  before update on public.analyses
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- R    L    S 
-- ---------------------------------------------------------------------------
alter table public.analyses enable row level security;

drop policy if exists "service role full access on analyses" on public.analyses;

create policy "service role full access on analyses"
  on public.analyses for all to service_role using (true) with check (true);