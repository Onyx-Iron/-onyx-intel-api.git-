-- Historical automated rows may have been marked approved by legacy workers
-- without source manifests or quantity validation. Preserve any estimate rows
-- already created, flag them for reconciliation, and return the source
-- takeoffs to human review instead of silently treating them as authoritative.
insert into public.takeoff_reconciliation_exceptions (
  tenant_id, project_id, source_takeoff_id, estimate_item_id, exception_type, details
)
select
  t.tenant_id,
  t.project_id,
  t.id,
  e.id,
  'legacy_automated_approval_without_evidence',
  jsonb_build_object(
    'source_method', t.source_method,
    'prior_review_status', t.review_status,
    'quantity_validation_status', t.quantity_validation_status,
    'migration', '20260814080000'
  )
from public.takeoff_items t
join public.estimate_items e
  on e.tenant_id = t.tenant_id and e.project_id = t.project_id and e.source_takeoff_id = t.id
where t.source_method in ('ai_vision','deterministic')
  and t.review_status = 'approved'
  and t.quantity_validation_status <> 'validated'
  and not exists (
    select 1 from public.takeoff_reconciliation_exceptions x
    where x.tenant_id = t.tenant_id and x.project_id = t.project_id
      and x.source_takeoff_id = t.id and x.estimate_item_id = e.id
      and x.exception_type = 'legacy_automated_approval_without_evidence'
  );

update public.takeoff_items
set review_status = 'suggested',
    reviewed_by = null,
    reviewed_at = null,
    approved_by = null,
    approved_at = null,
    quantity_validation_reason = coalesce(quantity_validation_reason, 'legacy_approval_missing_evidence'),
    row_version = row_version + 1,
    updated_at = now()
where source_method in ('ai_vision','deterministic')
  and review_status = 'approved'
  and quantity_validation_status <> 'validated';
