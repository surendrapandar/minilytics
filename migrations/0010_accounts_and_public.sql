-- Self-hosted accounts: people sign up with email + password (when ALLOW_SIGNUP is on) and the admin can change
-- their password from the dashboard. Hosted (Google) users leave these empty.
ALTER TABLE users ADD COLUMN password_hash TEXT;
-- Sessions started before this time are signed out (set when the password changes).
ALTER TABLE users ADD COLUMN password_changed_at INTEGER;

-- 1 = anyone with the link can view the dashboard (not its settings) without logging in.
ALTER TABLE sites ADD COLUMN public INTEGER NOT NULL DEFAULT 0;
