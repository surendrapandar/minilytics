-- Stripe webhooks, next to Dodo. Each site picks the provider it uses (or both).
ALTER TABLE sites ADD COLUMN stripe_webhook_secret TEXT;

-- Stripe Checkout session (cs_...) of a payment. Stripe sends buyers back to the success URL with
-- ?session_id=cs_..., which links the payment to the visitor like Dodo's ?payment_id= does.
ALTER TABLE payments ADD COLUMN checkout_id TEXT;
