-- Removing a notification rule.
--
-- Notifications and queued deliveries keep a reference to the rule that made
-- them, so a removed rule stays as a row with removed_at set and leaves every
-- list. A removed rule is also disabled, and the check holds it so: every
-- path that fires rules reads only enabled ones. The existing update policy
-- covers the change; the routes allow it to an administrator only.

alter table public.notification_rules
  add column removed_at timestamptz,
  add constraint notification_rules_removed_disabled check (removed_at is null or not enabled);
