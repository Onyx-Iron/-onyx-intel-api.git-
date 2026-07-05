-- Billing columns on tenants (idempotent)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'trial';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paddle_customer_id text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paddle_subscription_id text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS seat_limit int DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS seats_used int DEFAULT 1;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_credits_remaining int DEFAULT 10;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS ai_credits_reset_at timestamptz;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '3 days');
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS comp_until timestamptz;

CREATE INDEX IF NOT EXISTS idx_tenants_paddle_customer_id ON tenants(paddle_customer_id) WHERE paddle_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_paddle_subscription_id ON tenants(paddle_subscription_id) WHERE paddle_subscription_id IS NOT NULL;
