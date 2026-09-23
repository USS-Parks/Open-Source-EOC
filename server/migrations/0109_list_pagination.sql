-- Keyset pagination for the remaining operational lists.
--
-- Each list pages by its sort key plus id, so a page boundary inside one
-- timestamp or one item name stays exact. Where an older index is a prefix of
-- the new one it is dropped; the new index serves every query the old one did.

create index threads_page on public.threads (jurisdiction_id, created_at desc, id desc);

create index cap_alerts_page on public.cap_alerts (jurisdiction_id, created_at desc, id desc);
drop index public.cap_alerts_jurisdiction;

create index damage_assessments_page
  on public.damage_assessments (jurisdiction_id, created_at desc, id desc);

create index sitreps_page on public.sitreps (jurisdiction_id, composed_at desc, id desc);
drop index public.sitreps_jurisdiction;

create index iaps_incident_page on public.iaps (incident_id, created_at desc, id desc);
drop index public.iaps_incident;

create index resource_requests_item_page on public.resource_requests (jurisdiction_id, item, id);

create index aar_observations_page on public.aar_observations (incident_id, created_at, id);
drop index public.aar_observations_incident;

create index corrective_actions_page on public.corrective_actions (jurisdiction_id, created_at, id);

create index staff_checkins_on_duty on public.staff_checkins (jurisdiction_id, checked_in_at, id)
  where checked_out_at is null;

create index tracking_events_chain on public.tracking_events (object_id, occurred_at, created_at, id);
drop index public.tracking_events_object;

create index operational_relationships_page
  on public.operational_relationships (incident_id, created_at desc, id desc);

create index feed_items_page on public.feed_items (feed_id, fetched_at desc, id desc);
drop index public.feed_items_feed;

create index files_page on public.files (jurisdiction_id, created_at desc, id desc);
drop index public.files_jurisdiction;
