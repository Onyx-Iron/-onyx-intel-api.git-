ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS billing_event_occurred_at timestamptz;

-- Apply only newer Paddle state. This also ensures routine same-plan updates
-- cannot replenish AI credits that were already consumed.
CREATE OR REPLACE FUNCTION public.apply_tenant_billing_event(
  p_tenant_id uuid,
  p_event_occurred_at timestamptz,
  p_patch jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  billing public.tenants%ROWTYPE;
  target_plan text;
  reset_entitlements boolean;
  allowed_keys constant text[] := ARRAY[
    'plan_tier', 'subscription_status', 'paddle_customer_id',
    'paddle_subscription_id', 'seat_limit', 'ai_credits_remaining',
    'ai_credits_reset_at'
  ];
BEGIN
  IF p_tenant_id IS NULL OR p_event_occurred_at IS NULL
     OR p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Invalid billing event arguments';
  END IF;
  IF p_patch - allowed_keys <> '{}'::jsonb THEN
    RAISE EXCEPTION 'Billing event contains unsupported fields';
  END IF;

  SELECT *
    INTO billing
    FROM public.tenants
   WHERE id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  IF billing.billing_event_occurred_at IS NOT NULL
     AND p_event_occurred_at <= billing.billing_event_occurred_at THEN
    RETURN false;
  END IF;

  target_plan := CASE
    WHEN p_patch ? 'plan_tier' THEN p_patch->>'plan_tier'
    ELSE billing.plan_tier
  END;
  IF target_plan NOT IN ('trial', 'solo', 'crew', 'business', 'enterprise', 'comp') THEN
    RAISE EXCEPTION 'Invalid plan tier';
  END IF;

  reset_entitlements := target_plan IS DISTINCT FROM billing.plan_tier
    OR (
      billing.paddle_subscription_id IS NULL
      AND p_patch ? 'paddle_subscription_id'
      AND p_patch->>'paddle_subscription_id' IS NOT NULL
    );

  UPDATE public.tenants
     SET plan_tier = target_plan,
         subscription_status = CASE WHEN p_patch ? 'subscription_status'
           THEN p_patch->>'subscription_status' ELSE billing.subscription_status END,
         paddle_customer_id = CASE WHEN p_patch ? 'paddle_customer_id'
           THEN p_patch->>'paddle_customer_id' ELSE billing.paddle_customer_id END,
         paddle_subscription_id = CASE WHEN p_patch ? 'paddle_subscription_id'
           THEN p_patch->>'paddle_subscription_id' ELSE billing.paddle_subscription_id END,
         seat_limit = CASE WHEN p_patch ? 'seat_limit'
           THEN (p_patch->>'seat_limit')::integer ELSE billing.seat_limit END,
         ai_credits_remaining = CASE
           WHEN reset_entitlements AND p_patch ? 'ai_credits_remaining'
             THEN (p_patch->>'ai_credits_remaining')::integer
           ELSE billing.ai_credits_remaining
         END,
         ai_credits_reset_at = CASE
           WHEN reset_entitlements AND p_patch ? 'ai_credits_reset_at'
             THEN (p_patch->>'ai_credits_reset_at')::timestamptz
           ELSE billing.ai_credits_reset_at
         END,
         billing_event_occurred_at = p_event_occurred_at
   WHERE id = p_tenant_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_tenant_billing_event(uuid, timestamptz, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_tenant_billing_event(uuid, timestamptz, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.apply_tenant_billing_event(uuid, timestamptz, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_tenant_billing_event(uuid, timestamptz, jsonb) TO service_role;
