-- Approximate visitor location (city level, rounded to ~1 km) for the live globe.
ALTER TABLE sessions ADD COLUMN lat REAL;
ALTER TABLE sessions ADD COLUMN lon REAL;
