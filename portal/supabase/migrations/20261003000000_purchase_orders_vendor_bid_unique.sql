-- One purchase order per awarded vendor bid. Concurrent "Approve & Generate PO"
-- calls previously raced on check-then-act and could insert multiple POs for
-- the same bid (or for sibling bids on an already-awarded request). Unique
-- constraint turns the second insert into a 409 at the API layer.
DO $$
BEGIN
  IF to_regclass('public.purchase_orders') IS NULL THEN
    RAISE NOTICE 'purchase_orders missing — skip vendor_bid_id unique';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_orders_vendor_bid_id_key'
      AND conrelid = 'public.purchase_orders'::regclass
  ) THEN
    -- Drop non-unique index if present so UNIQUE can replace it cleanly.
    DROP INDEX IF EXISTS public.idx_purchase_orders_vendor_bid_id;
    ALTER TABLE public.purchase_orders
      ADD CONSTRAINT purchase_orders_vendor_bid_id_key UNIQUE (vendor_bid_id);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'purchase_orders_vendor_bid_id_key already exists';
  WHEN unique_violation THEN
    RAISE WARNING 'purchase_orders has duplicate vendor_bid_id rows; unique constraint not applied';
END $$;
