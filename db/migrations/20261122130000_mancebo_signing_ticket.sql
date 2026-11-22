create table public.mancebo_signing_install (
  singleton boolean primary key default true check (singleton),
  tenant_id uuid not null
);

create table public.mancebo_signing_ticket (
  ticket_hash bytea primary key check (octet_length(ticket_hash) = 32),
  tenant_id uuid not null,
  subject uuid not null,
  email text not null,
  destination text not null check (destination in ('documents', 'new')),
  expires_at timestamptz not null default (now() + interval '60 seconds')
);

create index mancebo_signing_ticket_expiry_idx
  on public.mancebo_signing_ticket (expires_at);
