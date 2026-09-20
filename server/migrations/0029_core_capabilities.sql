-- Core-capability element on AAR observations and corrective actions (VEOC-70).
-- The capability text already names one of the 32 National Preparedness Goal
-- Core Capabilities (validated at the API against the npg.core_capabilities
-- dictionary). This adds the HSEEP POETE element (Planning, Organization,
-- Equipment, Training, Exercises, or none) so an improvement item can say
-- where the capability gap lives, matching the WebEOC AAR field. Existing rows
-- default to 'none'.

alter table aar_observations
  add column capability_element text not null default 'none';

alter table corrective_actions
  add column capability_element text not null default 'none';
