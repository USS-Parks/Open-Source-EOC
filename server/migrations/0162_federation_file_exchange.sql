-- Exchange by file (AG-04). Where no network path reaches a partner, an
-- administrator exports what waits for it as a file of signed batches; the
-- partner imports the file through its receive lane and returns a receipt,
-- signed with its key, naming the batches it applied by digest.
--
-- On the sending side each exported batch is kept with the outbox entries it
-- carries, so a receipt marks delivered only entries this instance put in a
-- file for that partner. A batch exported again in a later file has a row
-- per export, and a receipt for either marks its entries.
-- ponytail: rows are never purged; one per batch per export, a digest and
-- entry ids. Add them to the federation_outbox retention class if exports
-- run into the hundreds of thousands.
create table public.federation_file_exports (
  id uuid primary key default gen_random_uuid(),
  peer_id uuid not null references public.peers(id),
  digest text not null,
  entry_ids uuid[] not null,
  created_at timestamptz not null default now()
);
create index federation_file_exports_digest on public.federation_file_exports (peer_id, digest);

-- On the receiving side each batch applied from a partner's file, by digest,
-- so importing the same file again applies nothing.
create table public.federation_file_imports (
  peer_id uuid not null references public.peers(id),
  digest text not null,
  created_at timestamptz not null default now(),
  primary key (peer_id, digest)
);

alter table public.federation_file_exports enable row level security;
alter table public.federation_file_imports enable row level security;

create policy file_exports_admin on public.federation_file_exports
  for all using (exists (select 1 from public.peers p
                         where p.id = federation_file_exports.peer_id and public.is_admin_of(p.jurisdiction_id)))
  with check (exists (select 1 from public.peers p
                      where p.id = federation_file_exports.peer_id and public.is_admin_of(p.jurisdiction_id)));
create policy file_imports_admin on public.federation_file_imports
  for all using (exists (select 1 from public.peers p
                         where p.id = federation_file_imports.peer_id and public.is_admin_of(p.jurisdiction_id)))
  with check (exists (select 1 from public.peers p
                      where p.id = federation_file_imports.peer_id and public.is_admin_of(p.jurisdiction_id)));

grant select, insert on table public.federation_file_exports to app_runtime;
grant select, insert on table public.federation_file_imports to app_runtime;
