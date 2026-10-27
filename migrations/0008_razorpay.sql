-- Razorpay webhook (POST /api/webhooks/razorpay/:siteId). The secret is the one typed in Razorpay → Settings → Webhooks.
ALTER TABLE sites ADD COLUMN razorpay_webhook_secret TEXT;
-- Optional: only count payments from these payment links (plink_…) or subscription plans (plan_…), comma-separated.
-- Needed when one Razorpay account sells several products (every webhook receives every payment).
ALTER TABLE sites ADD COLUMN razorpay_filter_ids TEXT;
