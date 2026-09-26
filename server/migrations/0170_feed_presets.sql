-- Live feed presets: a feed's kind may name one public source's own format
-- (NWS alerts, NIFC WFIGS perimeters and incidents, USGS earthquakes and
-- ShakeMap, NOAA NWPS gauges, a utility outage map, ORNL ODIN county
-- outages), parsed and drawn with that source's symbology. The four general
-- formats are unchanged.
alter table public.feeds drop constraint feeds_kind_check;
alter table public.feeds add constraint feeds_kind_check check (kind = any (array[
  'cap', 'geojson', 'georss', 'cot',
  'nws_alerts', 'wfigs_perimeters', 'wfigs_incidents',
  'usgs_earthquakes', 'usgs_shakemap', 'nwps_gauges', 'utility_outages', 'odin_outages'
]));
