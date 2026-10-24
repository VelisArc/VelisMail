-- Receiving is only ready when the provider webhook has been verified for a
-- domain, not merely when a signing secret was typed into the setup form.
-- The setup gate reads this marker so an unfinished workspace cannot open the
-- dashboard.
ALTER TABLE custom_domains
    ADD COLUMN IF NOT EXISTS inbound_webhook_verified_at TIMESTAMPTZ;
