-- Canonical geocode for the user's target city/region (drives Places Nearby lat/lng + radius).
alter table campaigns
  add column if not exists location_lat double precision,
  add column if not exists location_lng double precision;
