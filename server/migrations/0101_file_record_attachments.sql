-- D27: files may be attached to an exact board record. Existing attachment
-- kinds remain valid; the service verifies each target belongs to the upload
-- jurisdiction before writing the immutable file row.
alter table files drop constraint files_attached_kind_check;
alter table files add constraint files_attached_kind_check
  check (attached_kind in ('none', 'board', 'record', 'incident', 'library'));