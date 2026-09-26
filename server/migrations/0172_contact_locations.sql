-- Where a contact can be found, so the map can notify the people in an
-- area. A contact may carry a street address and a point set directly. When
-- the address is saved, the offline gazetteer places it once, as
-- address_point; the area search reads only stored points, the set point
-- before the address's. Only the jurisdiction's writers read any of the
-- three, and the area search returns names and channels, never where anyone is.

alter table public.contacts
  add column address text check (length(address) between 1 and 300),
  add column location public.geometry(Point, 4326),
  add column address_point public.geometry(Point, 4326);
