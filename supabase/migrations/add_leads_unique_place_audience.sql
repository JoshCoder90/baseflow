-- Allow same business (place_id) in multiple audiences
-- Replace unique(place_id) with unique(place_id, audience_id)

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_place_id_key;

ALTER TABLE leads
ADD CONSTRAINT unique_place_audience UNIQUE (place_id, audience_id);
