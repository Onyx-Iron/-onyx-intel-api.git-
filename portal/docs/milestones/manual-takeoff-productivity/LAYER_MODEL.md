# Layer Model

**Not built this milestone.** Per the "Reliability + core editing" scope decision, layers (table, layer-assignment FK, UI, create/rename/reorder/hide/lock/reassign) were explicitly deferred in favor of the outbox worker and optimistic-concurrency editing.

## What exists today instead
`topo_nodes` already has a free-text `layer_assignment` column (defaulting to `"manual"`), used only as a label — no dedicated `takeoff_layers` table, no per-object layer FK on `manual_takeoffs`, no visibility/lock semantics, no color/opacity, no sort order.

## What a follow-up milestone would need (from the original spec, unimplemented)
A `takeoff_layers` table: `id, tenant_id, project_id, name, description, color, opacity, visible, locked, sort_order, discipline, trade, default_cost_code, default_assembly, created_by, updated_by, timestamps` — plus a `layer_id` FK on `manual_takeoffs` (and possibly the other geometry tables), a default/unassigned layer guaranteed to exist, create/rename/reorder/hide/lock/reassign actions, layer-scoped selection and filtering (filtering must never change stored quantities), audited layer changes, and a "reassign or confirm" flow before deleting a populated layer.
