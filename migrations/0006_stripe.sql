-- Stripe webhooks, next to Dodo. Each site picks the provider it uses (or both).
ALTER TABLE sites ADD COLUMN stripe_webhook_secret TEXT;

-- payments.checkout_id (the Stripe Checkout session, cs_...) already comes from 0004_polar_payments.
-- Stripe sends buyers back to the success URL with ?session_id=cs_..., which links the payment to the
-- visitor like Dodo's ?payment_id= does.
