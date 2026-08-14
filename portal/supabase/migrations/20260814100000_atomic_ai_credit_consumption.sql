-- Enforce monthly AI generation allowances in the database transaction that
-- spends them. Row locking prevents concurrent serverless requests from both
-- consuming the same final credit.
CREATE OR REPLACE FUNCTION public.consume_ai_credits(
  p_tenant_id uuid,
  p_count integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  billing public.tenants%ROWTYPE;
  monthly_limit integer;
  remaining integer;
  next_reset timestamptz;
BEGIN
  IF p_tenant_id IS NULL OR p_count < 1 OR p_count > 100 THEN
    RAISE EXCEPTION 'Invalid AI credit arguments';
  END IF;

  SELECT *
    INTO billing
    FROM public.tenants
   WHERE id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'no_plan', 'remaining', 0);
  END IF;

  IF (billing.comp_until IS NOT NULL AND billing.comp_until > now())
     OR billing.plan_tier IN ('enterprise', 'comp') THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'unlimited', 'remaining', -1);
  END IF;

  IF billing.plan_tier = 'trial' THEN
    IF billing.trial_ends_at IS NULL OR billing.trial_ends_at <= now() THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'inactive', 'remaining', 0);
    END IF;
    monthly_limit := 10;
  ELSE
    IF billing.subscription_status IS NULL
       OR billing.subscription_status NOT IN ('active', 'trialing') THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'inactive',
        'remaining', greatest(coalesce(billing.ai_credits_remaining, 0), 0)
      );
    END IF;

    monthly_limit := CASE billing.plan_tier
      WHEN 'solo' THEN 100
      WHEN 'crew' THEN 500
      WHEN 'business' THEN 2000
      ELSE 0
    END;
  END IF;

  remaining := greatest(coalesce(billing.ai_credits_remaining, 0), 0);
  next_reset := billing.ai_credits_reset_at;

  -- Paid allowances renew monthly. Trial credits never renew during the
  -- three-day trial, even if a malformed reset timestamp is present.
  IF billing.plan_tier <> 'trial'
     AND next_reset IS NOT NULL
     AND next_reset <= now() THEN
    remaining := monthly_limit;
    next_reset := now() + interval '1 month';
  ELSIF billing.plan_tier <> 'trial' AND next_reset IS NULL THEN
    next_reset := now() + interval '1 month';
  END IF;

  IF remaining < p_count THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'no_credits',
      'remaining', remaining,
      'reset_at', next_reset
    );
  END IF;

  remaining := remaining - p_count;
  UPDATE public.tenants
     SET ai_credits_remaining = remaining,
         ai_credits_reset_at = next_reset
   WHERE id = p_tenant_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'reason', 'consumed',
    'remaining', remaining,
    'reset_at', next_reset
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_ai_credits(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_ai_credits(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION public.consume_ai_credits(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_credits(uuid, integer) TO service_role;
