-- Sharing agreements are read-only unless an admin opts into writes (INV-7).
-- 0020 originally defaulted can_write to true; this flips the default for
-- new rows. Existing agreements keep the value they were stored with.

alter table sharing_agreements alter column can_write set default false;
