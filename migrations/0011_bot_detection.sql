-- Likely bots are kept, but counted apart from real visitors.
-- bot: why the visit was flagged when it arrived ('datacenter': from a cloud or hosting network, 'no_origin': not sent by a browser).
-- engaged: 1 once the visitor moved the mouse, touched the screen, scrolled with a wheel or typed. A visit that is flagged or
-- never engaged counts as a likely bot. Visits from before this existed can't be judged, so they stay engaged.
ALTER TABLE sessions ADD COLUMN bot TEXT;
ALTER TABLE sessions ADD COLUMN engaged INTEGER NOT NULL DEFAULT 1;
