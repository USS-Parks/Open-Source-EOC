-- Geospatial layer support (VEOC-16, F6).
-- Every board with a geometry field is automatically a live layer: the
-- record's geometry lands in a PostGIS column at write time for spatial
-- indexing, while the GeoJSON in the record data stays the wire truth.

create extension if not exists postgis;

alter table board_records add column geom geometry(Geometry, 4326);
create index board_records_geom on board_records using gist (geom)
  where geom is not null;
