-- 'lifetime' (one-time payment) or 'monthly' (subscription). Only lifetime buyers use up lifetime-deal spots.
ALTER TABLE users ADD COLUMN plan TEXT;
-- Everyone who paid before this was a lifetime buyer.
UPDATE users SET plan = 'lifetime' WHERE paid_at IS NOT NULL AND dodo_subscription_id IS NULL;
