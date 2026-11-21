-- REVIEW DRAFT ONLY — NOT A MIGRATION; do not apply to production.
-- Generate the real migration with `supabase migration new radar_source_releases`
-- after reconciling Balthazar's unpublished schema changes.
--
-- Service-role-only ingestion; no anon/authenticated table grants or RLS
-- policies at this stage. Human review will require separate protected tables.

create table if not exists public.radar_source_releases (
  source_key text primary key,
  source text not null check (source = 'find-a-tender'),
  release_id text not null,
  ocid text not null,
  title text not null,
  description text not null default '',
  buyer_name text not null default '',
  published_at timestamptz not null,
  deadline_at timestamptz,
  source_url text not null,
  cpv_codes text[] not null default '{}',
  value_amount numeric(18,2),
  value_currency char(3),
  relevance_score smallint not null check (relevance_score between 0 and 100),
  relevance_priority text not null check (relevance_priority in ('high','review','low')),
  scoring_evidence text[] not null default '{}',
  scoring_warnings text[] not null default '{}',
  last_seen_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint radar_nonnegative_value check (value_amount is null or value_amount >= 0),
  constraint radar_release_key_unique unique (source, release_id)
);
create index if not exists radar_ocid_idx on public.radar_source_releases (ocid);
create index if not exists radar_recent_idx on public.radar_source_releases (published_at desc);
alter table public.radar_source_releases enable row level security;
-- There are deliberately no authenticated user policies.
-- No direct client access until an authorised API and reviewed access model exist.
