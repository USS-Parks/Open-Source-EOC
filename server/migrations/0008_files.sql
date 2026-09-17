-- File library and search (VEOC-15).
-- File rows are immutable: a new version is a new row whose `supersedes`
-- points at the old one, so the chain is history, never replacement. The
-- bytes live in content-addressed on-disk storage (plain disk, air-gap
-- friendly), so identical content stored twice is one blob.

create table files (
  id uuid primary key default gen_random_uuid(),
  jurisdiction_id uuid not null references jurisdictions (id),
  name text not null,
  content_type text not null,
  size bigint not null,
  sha256 text not null,
  version integer not null default 1,
  supersedes uuid references files (id),
  attached_kind text not null default 'none'
    check (attached_kind in ('none', 'board', 'incident', 'library')),
  attached_id uuid,
  uploaded_by uuid not null references persons (id),
  uploaded_by_position uuid references positions (id),
  created_at timestamptz not null default now()
);
create index files_jurisdiction on files (jurisdiction_id, created_at desc);
create index files_attachment on files (attached_kind, attached_id)
  where attached_id is not null;

grant select, insert on files to app_runtime;
revoke update, delete on files from app_runtime;

create trigger files_immutable
  before update or delete on files
  for each row execute function audit_events_immutable();

alter table files enable row level security;
create policy files_read on files for select
  using (is_member_of(jurisdiction_id));
create policy files_write on files for insert
  with check (uploaded_by = current_person() and is_writer_of(jurisdiction_id));

-- Full-text search support (permission awareness comes from RLS on the
-- underlying tables, applied because search runs under the actor).
create index board_records_fts on board_records
  using gin (to_tsvector('english', data::text));
create index libraries_fts on libraries
  using gin (to_tsvector('english', title || ' ' || body));
-- Filenames tokenize as single "file" tokens; separators become spaces so
-- the words inside are searchable.
create index files_fts on files
  using gin (to_tsvector('english', translate(name, '-._/', '    ')));
create index audit_events_fts on audit_events
  using gin (to_tsvector('english', category || ' ' || payload::text));
