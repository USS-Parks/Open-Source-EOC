-- Signed peer identity (AG-03, ADR-0006). The instance holds one Ed25519 key
-- pair: the public key its administrators hand to partners, and the private
-- key, envelope-encrypted under the server key by the application. A
-- partner's public key is recorded on its peer, and a batch from that partner
-- is applied only when its signature verifies under that key. The public key
-- is public by nature and the private key is readable only through the server
-- key, so any runtime session may read the row; the one row is created on
-- first use.
create table public.federation_identity (
  id uuid primary key default gen_random_uuid(),
  public_key text not null,
  private_key_envelope text not null,
  created_at timestamptz not null default now()
);
create unique index federation_identity_one on public.federation_identity ((true));
alter table public.federation_identity enable row level security;
create policy federation_identity_read on public.federation_identity for select using (true);
create policy federation_identity_create on public.federation_identity for insert with check (true);
grant select, insert on table public.federation_identity to app_runtime;

-- The partner's public key, set by an administrator after the partners have
-- compared fingerprints. The peers_link policy already limits updates to the
-- peer's administrators.
alter table public.peers add column public_key text;
grant update (public_key) on table public.peers to app_runtime;

-- Revoking an agreement removes it and whatever it still had waiting for the
-- peer: nothing more is queued, claimed or accepted for that board, in either
-- direction. The revocation stays in the audit trail.
create policy agreements_revoke on public.sharing_agreements
  for delete using (exists (select 1 from public.peers p
                            where p.id = sharing_agreements.peer_id and public.is_admin_of(p.jurisdiction_id)));
grant delete on table public.sharing_agreements to app_runtime;

create policy outbox_revoke on public.federation_outbox
  for delete using (exists (select 1 from public.peers p
                            where p.id = federation_outbox.peer_id and public.is_admin_of(p.jurisdiction_id)));
grant delete on table public.federation_outbox to app_runtime;
