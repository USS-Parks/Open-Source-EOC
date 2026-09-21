-- Per-load ingest tally on a dataset (VEOC-79C2). A load records how many items
-- the source sent (received) and how many were not persisted (rejected: invalid
-- or a duplicate); the persisted count is item_count (accepted). Null until the
-- first productive load; a failed or empty refresh leaves the last good tally in
-- place so the operator keeps seeing the last known numbers.
alter table data_pack_datasets
  add column last_received integer check (last_received is null or last_received >= 0),
  add column last_rejected integer check (last_rejected is null or last_rejected >= 0);
