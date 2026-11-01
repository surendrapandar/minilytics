-- Map each site to its exact Search Console property identifier (sc-domain:... or https://.../).
-- Service account credentials remain in Cloudflare Secrets, never in D1.
ALTER TABLE sites ADD COLUMN gsc_property TEXT;
