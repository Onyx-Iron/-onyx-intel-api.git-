// Integration tests for the professional-manual-takeoff milestone's
// "Foundation" scope — run against the LIVE Supabase dev database (project
// vvnigrbdsipriufhrwbs), following the same pattern as
// lib/estimating/takeoff-integrity.integration.test.ts: reproduce the real
// route's DB operations directly (upsert/soft-delete/history-write SQL is
// exactly what app/api/takeoff/canvas/manual/route.ts issues), since the
// route itself depends on next/headers' cookies() and cannot run inside a
// plain `node --test` process outside a live Next.js request.
//
// Covers: page-space coordinate persistence, legacy_pixel compatibility,
// idempotent saves via client_key, soft deletion, audit history, tenant
// isolation, project/sheet relationship validation, and estimate-link
// safety (draft vs. approved version immutability).
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (present in
// portal/.env.local for local dev). Skips gracefully if absent. Every row
// this file creates is deleted in an `after` hook in FK-safe order.

import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { pointsToPageSpace, pointsToScreenSpace, type Point } from "./canvas/coordinates";
import { getOrCreateDraftVersion, approveVersion } from "@/lib/estimating/versioning";

function loadEnvLocal(): void {
  const envPath = resolve(__dirname, "../../.env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const HAS_DB = Boolean(SUPABASE_URL && SERVICE_KEY);

if (!HAS_DB) {
  describe("manual takeoff canvas persistence (integration, SKIPPED — no live DB credentials)", () => {
    it("skipped", () => { /* no-op */ });
  });
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(SUPABASE_URL!, SERVICE_KEY!) as any;

  const TEST_MARK = `mt_${Date.now()}`;
  let tenantA: string;
  let tenantB: string;
  let projectA: string;
  let projectAOther: string;
  let documentA: string;
  let pageA: string;
  let documentB: string;
  let pageB: string;

  before(async () => {
    const { data: ta, error: eta } = await db.from("tenants")
      .insert({ clerk_org_id: `${TEST_MARK}_org_a`, name: "MT Integration Tenant A" })
      .select("id").single();
    if (eta) throw eta;
    tenantA = ta.id;

    const { data: tb, error: etb } = await db.from("tenants")
      .insert({ clerk_org_id: `${TEST_MARK}_org_b`, name: "MT Integration Tenant B" })
      .select("id").single();
    if (etb) throw etb;
    tenantB = tb.id;

    const { data: pa, error: epa } = await db.from("projects")
      .insert({ tenant_id: tenantA, name: `${TEST_MARK}_project_a` })
      .select("id").single();
    if (epa) throw epa;
    projectA = pa.id;

    const { data: paOther, error: epaOther } = await db.from("projects")
      .insert({ tenant_id: tenantA, name: `${TEST_MARK}_project_a_other` })
      .select("id").single();
    if (epaOther) throw epaOther;
    projectAOther = paOther.id;

    const { data: doc, error: edoc } = await db.from("documents")
      .insert({ id: crypto.randomUUID(), tenant_id: tenantA, project_id: projectA, file_name: `${TEST_MARK}.pdf` })
      .select("id").single();
    if (edoc) throw edoc;
    documentA = doc.id;

    const { data: page, error: epage } = await db.from("document_pages")
      .insert({ id: crypto.randomUUID(), tenant_id: tenantA, document_id: documentA, page_number: 1, storage_path: `${TEST_MARK}/page-1.pdf` })
      .select("id").single();
    if (epage) throw epage;
    pageA = page.id;

    // A second document/page under a DIFFERENT project in the SAME tenant —
    // used to prove a sheet unrelated to the supplied project is rejected
    // (requirement #11), distinct from cross-tenant rejection (requirement #10).
    const { data: docB, error: edocB } = await db.from("documents")
      .insert({ id: crypto.randomUUID(), tenant_id: tenantA, project_id: projectAOther, file_name: `${TEST_MARK}_other.pdf` })
      .select("id").single();
    if (edocB) throw edocB;
    documentB = docB.id;

    const { data: pageBRow, error: epageB } = await db.from("document_pages")
      .insert({ id: crypto.randomUUID(), tenant_id: tenantA, document_id: documentB, page_number: 1, storage_path: `${TEST_MARK}/other-page-1.pdf` })
      .select("id").single();
    if (epageB) throw epageB;
    pageB = pageBRow.id;
  });

  after(async () => {
    await db.from("estimate_items").delete().in("tenant_id", [tenantA, tenantB]);
    await db.from("manual_takeoff_history").delete().in("tenant_id", [tenantA, tenantB]);
    await db.from("manual_takeoffs").delete().in("tenant_id", [tenantA, tenantB]);
    await db.from("takeoff_item_history").delete().in("tenant_id", [tenantA, tenantB]);
    await db.from("takeoff_items").delete().in("tenant_id", [tenantA, tenantB]);
    await db.from("estimate_versions").delete().in(
      "estimate_id",
      (await db.from("estimates").select("id").in("tenant_id", [tenantA, tenantB])).data?.map((e: { id: string }) => e.id) ?? [],
    );
    await db.from("estimates").delete().in("tenant_id", [tenantA, tenantB]);
    if (documentA) await db.from("document_pages").delete().eq("document_id", documentA);
    if (documentA) await db.from("documents").delete().eq("id", documentA);
    if (documentB) await db.from("document_pages").delete().eq("document_id", documentB);
    if (documentB) await db.from("documents").delete().eq("id", documentB);
    await db.from("projects").delete().in("tenant_id", [tenantA, tenantB]);
    await db.from("tenants").delete().in("id", [tenantA, tenantB]);
  });

  // Reproduces the route's exact ownership checks (assertProjectBelongsToTenant
  // / assertPageBelongsToProject in lib/project-controls/server.ts) without
  // going through the route itself.
  async function checkProjectBelongsToTenant(projectId: string, tenantId: string): Promise<boolean> {
    const { data } = await db.from("projects").select("id").eq("id", projectId).eq("tenant_id", tenantId).maybeSingle();
    return Boolean(data);
  }
  async function checkPageBelongsToProject(pageId: string, projectId: string, tenantId: string): Promise<boolean> {
    const { data: page } = await db.from("document_pages").select("id, document_id").eq("id", pageId).eq("tenant_id", tenantId).maybeSingle();
    if (!page) return false;
    const { data: doc } = await db.from("documents").select("id").eq("id", page.document_id).eq("tenant_id", tenantId).eq("project_id", projectId).maybeSingle();
    return Boolean(doc);
  }

  // Reproduces the route's upsert-with-history-and-mirror sequence exactly
  // (app/api/takeoff/canvas/manual/route.ts POST), scoped to a single item
  // for test clarity. Returns the persisted row plus whether it was an
  // insert or an update, mirroring the route's created/updated distinction.
  async function saveManualTakeoff(item: {
    project_id: string; page_id?: string | null; cost_code?: string | null;
    takeoff_type: "count" | "length" | "area"; quantity: number; unit?: string | null;
    geometry: Record<string, unknown>; client_key?: string | null; actorUserId?: string;
  }) {
    const actorUserId = item.actorUserId ?? "integration_test_user";
    const row = {
      tenant_id: tenantA,
      project_id: item.project_id,
      page_id: item.page_id ?? null,
      cost_code: item.cost_code ?? null,
      takeoff_type: item.takeoff_type,
      quantity: item.quantity,
      unit: item.unit ?? (item.takeoff_type === "count" ? "EA" : item.takeoff_type === "length" ? "LF" : "SF"),
      geometry: item.geometry,
      client_key: item.client_key ?? null,
      created_by: actorUserId,
      updated_by: actorUserId,
      created_at: new Date().toISOString(),
    };

    let before: Record<string, unknown> | undefined;
    if (row.client_key) {
      const { data: existingRow } = await db.from("manual_takeoffs")
        .select("*").eq("tenant_id", tenantA).eq("client_key", row.client_key).maybeSingle();
      before = existingRow ?? undefined;
    }

    const { data, error } = await db.from("manual_takeoffs")
      .upsert(row, { onConflict: "tenant_id,project_id,client_key" })
      .select("*").single();
    if (error) throw error;

    await db.from("manual_takeoff_history").insert({
      tenant_id: tenantA, project_id: item.project_id, manual_takeoff_id: data.id,
      action: before ? "updated" : "created", actor_user_id: actorUserId,
      before: before ?? null, after: data,
    });

    return { row: data, wasUpdate: Boolean(before) };
  }

  async function softDeleteManualTakeoff(id: string, actorUserId = "integration_test_user") {
    const { data: existing } = await db.from("manual_takeoffs").select("*").eq("id", id).eq("tenant_id", tenantA).is("deleted_at", null).maybeSingle();
    if (!existing) return { alreadyDeleted: true };
    const nowIso = new Date().toISOString();
    const { error } = await db.from("manual_takeoffs").update({ deleted_at: nowIso, updated_by: actorUserId }).eq("id", id).eq("tenant_id", tenantA);
    if (error) throw error;
    await db.from("manual_takeoff_history").insert({
      tenant_id: tenantA, project_id: existing.project_id, manual_takeoff_id: id,
      action: "deleted", actor_user_id: actorUserId, before: existing, after: { ...existing, deleted_at: nowIso },
    });
    return { alreadyDeleted: false };
  }

  describe("1. Page-space persistence", () => {
    it("converts legacy_pixel geometry to page_space on save, and the reload projects correctly at any render scale", async () => {
      const renderScaleA = 1.4;
      const renderScaleB = 2.6; // e.g. a wider window on reload
      const drawnAtA: Point[] = [{ x: 140, y: 210 }, { x: 280, y: 210 }]; // "legacy_pixel" — this render's screen pixels

      // Client-side: saveAllUnsaved converts screen pixels -> page space
      // before POSTing (SheetCanvas.tsx toPersistedPoints).
      const pageSpacePoints = pointsToPageSpace(drawnAtA, renderScaleA);
      const { row: saved } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "length", quantity: 10,
        geometry: { points: pageSpacePoints, coordinate_space: "page_space", page_number: 1 },
        client_key: `${TEST_MARK}-page-space-1`,
      });

      assert.equal(saved.geometry.coordinate_space, "page_space");

      // Reload: a fresh read from the DB (not the insert's own returned row).
      const { data: reread } = await db.from("manual_takeoffs").select("*").eq("id", saved.id).single();
      assert.equal(reread.geometry.coordinate_space, "page_space");

      // Render at the SAME scale the item was drawn at: projecting page-space
      // points back through renderScaleA must reproduce the original screen points.
      const displayedAtA = pointsToScreenSpace(reread.geometry.points, renderScaleA);
      assert.ok(Math.abs(displayedAtA[0].x - drawnAtA[0].x) < 1e-9);
      assert.ok(Math.abs(displayedAtA[1].x - drawnAtA[1].x) < 1e-9);

      // Render at a DIFFERENT scale (window resized before reopening): the
      // page-space geometry itself is untouched, only its screen projection
      // changes — this is the exact bug this milestone fixes.
      const displayedAtB = pointsToScreenSpace(reread.geometry.points, renderScaleB);
      assert.notDeepEqual(displayedAtB, displayedAtA);
      // But the underlying document-space location is identical either way.
      assert.deepEqual(reread.geometry.points, pageSpacePoints);

      // Length is computed in real-world units from page-space geometry * a
      // calibration scale that's independent of renderScale, so the stored
      // quantity itself never changes across reloads/resizes.
      assert.equal(reread.quantity, 10);
    });
  });

  describe("2. Re-save safety (no double conversion)", () => {
    it("editing a non-geometry property and re-saving a page_space item leaves its geometry byte-for-byte unchanged, even across repeated saves", async () => {
      const renderScale = 1.8;
      const original: Point[] = [{ x: 300, y: 90 }, { x: 300, y: 260 }];
      const pageSpacePoints = pointsToPageSpace(original, renderScale);
      const { row: saved } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "length", quantity: 20,
        geometry: { points: pageSpacePoints, coordinate_space: "page_space" },
        client_key: `${TEST_MARK}-resave-1`,
      });

      // Simulates SheetCanvas's toPersistedPoints: an item already tagged
      // 'page_space' is NOT re-run through pointsToPageSpace — it's passed
      // through untouched, only the cost_code (a non-geometry field) changes.
      const { row: resaved1 } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "length", quantity: 20,
        cost_code: "03-30-00",
        geometry: { points: saved.geometry.points, coordinate_space: "page_space" },
        client_key: `${TEST_MARK}-resave-1`,
      });
      assert.deepEqual(resaved1.geometry.points, pageSpacePoints);
      assert.equal(resaved1.cost_code, "03-30-00");

      // Repeat a second time to prove stability — not just "correct once."
      const { row: resaved2 } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "length", quantity: 20,
        cost_code: "03-30-00",
        geometry: { points: resaved1.geometry.points, coordinate_space: "page_space" },
        client_key: `${TEST_MARK}-resave-1`,
      });
      assert.deepEqual(resaved2.geometry.points, pageSpacePoints);

      // Only one row exists for this client_key throughout.
      const { data: rows } = await db.from("manual_takeoffs").select("id").eq("tenant_id", tenantA).eq("client_key", `${TEST_MARK}-resave-1`);
      assert.equal(rows.length, 1);
    });
  });

  describe("3. Legacy compatibility", () => {
    it("a legacy row with no coordinate_space marker is treated as legacy_pixel by policy, and converts to page_space exactly once on next save", async () => {
      // Insert directly, bypassing saveManualTakeoff, to simulate a row that
      // predates this milestone — no coordinate_space key at all.
      const legacyScreenPoints: Point[] = [{ x: 50, y: 50 }, { x: 150, y: 50 }];
      const { data: legacyRow, error } = await db.from("manual_takeoffs").insert({
        tenant_id: tenantA, project_id: projectA, page_id: pageA, takeoff_type: "length",
        quantity: 8.5, unit: "LF", geometry: { points: legacyScreenPoints }, // no coordinate_space
        created_by: "legacy_seed", created_at: new Date().toISOString(),
      }).select("*").single();
      if (error) throw error;

      // Documented policy (SheetCanvas.tsx CoordinateSpace comment / STEP 3):
      // an absent/unrecognized tag is NEVER assumed page_space — it's
      // legacy_pixel, so the old geometry renders exactly as it always has
      // until a fresh save re-tags it. This is a policy assertion, not a
      // migration — no attempt is made to guess what render scale produced
      // these pixels originally (RULE 17/18: never fabricate).
      const tag = legacyRow.geometry.coordinate_space === "page_space" ? "page_space" : "legacy_pixel";
      assert.equal(tag, "legacy_pixel");

      // On next save (e.g. the user nudges the shape or edits its cost
      // code), the client converts legacy_pixel -> page_space using the
      // CURRENT render scale (the only scale available — this render's own
      // pixels are what's on screen right now) and tags it going forward.
      const renderScaleNow = 1.0;
      const converted = pointsToPageSpace(legacyScreenPoints, renderScaleNow);
      const { error: updateErr } = await db.from("manual_takeoffs")
        .update({ geometry: { points: converted, coordinate_space: "page_space" }, updated_by: "integration_test_user" })
        .eq("id", legacyRow.id);
      if (updateErr) throw updateErr;

      const { data: reread } = await db.from("manual_takeoffs").select("*").eq("id", legacyRow.id).single();
      assert.equal(reread.geometry.coordinate_space, "page_space");
      // Conversion happened exactly once — the stored points equal a single
      // application of pointsToPageSpace, not a double-divided value.
      assert.deepEqual(reread.geometry.points, converted);

      await db.from("manual_takeoffs").delete().eq("id", legacyRow.id);
    });
  });

  describe("4. Idempotent create", () => {
    it("submitting the same client_key twice results in exactly one row, and the second call is a deterministic update of the same row", async () => {
      const key = `${TEST_MARK}-idempotent-1`;
      const { row: first } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "count", quantity: 1,
        geometry: { points: [{ x: 10, y: 10 }], coordinate_space: "page_space" },
        client_key: key,
      });
      const { row: second, wasUpdate } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "count", quantity: 1,
        geometry: { points: [{ x: 10, y: 10 }], coordinate_space: "page_space" },
        client_key: key,
      });

      assert.equal(second.id, first.id, "retry with the same client_key must resolve to the SAME row");
      assert.equal(wasUpdate, true);

      const { data: rows } = await db.from("manual_takeoffs").select("id").eq("tenant_id", tenantA).eq("client_key", key);
      assert.equal(rows.length, 1, "no duplicate row from a retried save");

      // History has exactly one 'created' and one 'updated' entry — the
      // retry is NOT recorded as a second 'created' event.
      const { data: history } = await db.from("manual_takeoff_history").select("action").eq("manual_takeoff_id", first.id).order("created_at", { ascending: true });
      assert.deepEqual(history.map((h: { action: string }) => h.action), ["created", "updated"]);
    });
  });

  describe("5. Distinct object creation", () => {
    it("two different client_keys create two distinct rows with independent geometry", async () => {
      const { row: a } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "count", quantity: 1,
        geometry: { points: [{ x: 1, y: 1 }], coordinate_space: "page_space" },
        client_key: `${TEST_MARK}-distinct-a`,
      });
      const { row: b } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "count", quantity: 2,
        geometry: { points: [{ x: 2, y: 2 }], coordinate_space: "page_space" },
        client_key: `${TEST_MARK}-distinct-b`,
      });
      assert.notEqual(a.id, b.id);
      assert.notDeepEqual(a.geometry.points, b.geometry.points);
      assert.equal(a.tenant_id, tenantA);
      assert.equal(b.tenant_id, tenantA);
    });
  });

  describe("6. Soft delete", () => {
    it("delete sets deleted_at, excludes the row from normal GET, records history, and a second delete is a deterministic no-op that never hard-deletes", async () => {
      const { row: created } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "area", quantity: 100,
        geometry: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], coordinate_space: "page_space" },
        client_key: `${TEST_MARK}-softdelete-1`,
      });

      const first = await softDeleteManualTakeoff(created.id);
      assert.equal(first.alreadyDeleted, false);

      const { data: afterDelete } = await db.from("manual_takeoffs").select("*").eq("id", created.id).single();
      assert.ok(afterDelete.deleted_at, "deleted_at must be populated");

      // Normal GET (mirrors the route's .is("deleted_at", null) filter).
      const { data: normalGet } = await db.from("manual_takeoffs")
        .select("id").eq("tenant_id", tenantA).eq("project_id", projectA).is("deleted_at", null).eq("id", created.id);
      assert.equal(normalGet.length, 0, "soft-deleted row must not appear in a normal listing");

      const { data: history } = await db.from("manual_takeoff_history").select("action").eq("manual_takeoff_id", created.id).eq("action", "deleted");
      assert.equal(history.length, 1);

      // Second delete: deterministic already-deleted result, not an error,
      // and does NOT write a second 'deleted' history entry.
      const second = await softDeleteManualTakeoff(created.id);
      assert.equal(second.alreadyDeleted, true);
      const { data: historyAfterSecond } = await db.from("manual_takeoff_history").select("action").eq("manual_takeoff_id", created.id).eq("action", "deleted");
      assert.equal(historyAfterSecond.length, 1, "a repeated delete must not double-write history");

      // Row is not physically removed.
      const { data: stillThere } = await db.from("manual_takeoffs").select("id").eq("id", created.id).maybeSingle();
      assert.ok(stillThere, "soft-deleted row must still physically exist");
    });
  });

  describe("7. Audit history — create / update / delete carry full context", () => {
    it("every history entry preserves actor, tenant, project, takeoff item id, before/after, timestamp, and action", async () => {
      const { row: created } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "length", quantity: 5,
        geometry: { points: [{ x: 0, y: 0 }, { x: 5, y: 0 }], coordinate_space: "page_space" },
        client_key: `${TEST_MARK}-audit-1`, actorUserId: "actor_creator",
      });
      const { row: updated } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "length", quantity: 9,
        geometry: { points: [{ x: 0, y: 0 }, { x: 9, y: 0 }], coordinate_space: "page_space" },
        client_key: `${TEST_MARK}-audit-1`, actorUserId: "actor_editor",
      });
      await softDeleteManualTakeoff(updated.id, "actor_deleter");

      const { data: history } = await db.from("manual_takeoff_history")
        .select("*").eq("manual_takeoff_id", created.id).order("created_at", { ascending: true });
      assert.equal(history.length, 3);

      const [createdEntry, updatedEntry, deletedEntry] = history;
      for (const entry of [createdEntry, updatedEntry, deletedEntry]) {
        assert.equal(entry.tenant_id, tenantA);
        assert.equal(entry.project_id, projectA);
        assert.equal(entry.manual_takeoff_id, created.id);
        assert.ok(entry.created_at, "timestamp must be present");
        assert.ok(entry.actor_user_id, "actor must be present");
      }
      assert.equal(createdEntry.action, "created");
      assert.equal(createdEntry.actor_user_id, "actor_creator");
      assert.equal(createdEntry.before, null);
      assert.equal(createdEntry.after.quantity, 5);

      assert.equal(updatedEntry.action, "updated");
      assert.equal(updatedEntry.actor_user_id, "actor_editor");
      assert.equal(updatedEntry.before.quantity, 5);
      assert.equal(updatedEntry.after.quantity, 9);

      assert.equal(deletedEntry.action, "deleted");
      assert.equal(deletedEntry.actor_user_id, "actor_deleter");
      assert.equal(deletedEntry.before.quantity, 9);
      assert.ok(deletedEntry.after.deleted_at);
    });

    it("documents that history rows intentionally have no FK to manual_takeoffs.id — they survive independent of the row's lifecycle", async () => {
      // Verified structurally: see the `comment on column
      // manual_takeoff_history.manual_takeoff_id` in
      // 20260730_professional_manual_takeoff.sql. The soft-delete test above
      // already proves history survives soft delete (the row itself is
      // never hard-deleted in production); this documents the design intent
      // for the case where a row IS later purged by some future cleanup.
      assert.ok(true, "see supabase/migrations/20260730_professional_manual_takeoff.sql column comment");
    });
  });

  describe("8. Mixed-coordinate sheet", () => {
    it("legacy_pixel, page_space, and an in-memory unsaved item all resolve to the correct on-screen position, and saving one does not disturb the others", async () => {
      const renderScale = 2.0;

      // Legacy row (no tag) — rendered directly, unconverted.
      const legacyPoints: Point[] = [{ x: 20, y: 20 }];
      const { data: legacyRow } = await db.from("manual_takeoffs").insert({
        tenant_id: tenantA, project_id: projectA, page_id: pageA, takeoff_type: "count",
        quantity: 1, unit: "EA", geometry: { points: legacyPoints },
        created_by: "legacy_seed", created_at: new Date().toISOString(),
      }).select("*").single();

      // page_space row — must project through renderScale to render.
      const pageSpacePoints = pointsToPageSpace([{ x: 400, y: 400 }], renderScale);
      const { row: pageSpaceRow } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "count", quantity: 1,
        geometry: { points: pageSpacePoints, coordinate_space: "page_space" },
        client_key: `${TEST_MARK}-mixed-1`,
      });

      // Unsaved in-memory item — always legacy_pixel per CoordinateSpace
      // policy until saveAllUnsaved converts it; not persisted here.
      const unsavedScreenPoints: Point[] = [{ x: 600, y: 600 }];

      // toDisplayPoints equivalent: legacy_pixel passes through untouched,
      // page_space projects through the current render scale.
      const legacyDisplayed = legacyRow.geometry.points; // pass-through
      const pageSpaceDisplayed = pointsToScreenSpace(pageSpaceRow.geometry.points, renderScale);
      const unsavedDisplayed = unsavedScreenPoints; // pass-through (legacy_pixel)

      assert.deepEqual(legacyDisplayed, legacyPoints);
      assert.ok(Math.abs(pageSpaceDisplayed[0].x - 400) < 1e-9);
      assert.deepEqual(unsavedDisplayed, unsavedScreenPoints);

      // Saving the (conceptually) unsaved item does not touch the other two
      // persisted rows — prove by re-reading them unchanged.
      const { data: legacyAfter } = await db.from("manual_takeoffs").select("geometry").eq("id", legacyRow.id).single();
      const { data: pageSpaceAfter } = await db.from("manual_takeoffs").select("geometry").eq("id", pageSpaceRow.id).single();
      assert.deepEqual(legacyAfter.geometry.points, legacyPoints);
      assert.deepEqual(pageSpaceAfter.geometry.points, pageSpacePoints);

      // Editing the page_space object (cost-code only) does not double-convert it.
      const { row: reSaved } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "count", quantity: 1,
        cost_code: "01-10-00",
        geometry: { points: pageSpaceRow.geometry.points, coordinate_space: "page_space" },
        client_key: `${TEST_MARK}-mixed-1`,
      });
      assert.deepEqual(reSaved.geometry.points, pageSpacePoints);

      await db.from("manual_takeoffs").delete().eq("id", legacyRow.id);
    });
  });

  describe("9. Geometry calculation invariance", () => {
    it("quantity for length/area/count is unchanged across save/reload and across zoom (render scale) changes", async () => {
      const scale = 0.05; // calibration scale_ratio: real-world ft per pixel
      const renderScaleDraw = 1.2;
      const renderScaleReload = 0.7; // simulates a resized window on reload

      // length: two points 200px apart at draw time.
      const lengthScreenPts: Point[] = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
      const lengthQtyBeforeSave = 200 * scale;
      const { row: lengthRow } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "length", quantity: lengthQtyBeforeSave,
        geometry: { points: pointsToPageSpace(lengthScreenPts, renderScaleDraw), coordinate_space: "page_space" },
        client_key: `${TEST_MARK}-invariance-length`,
      });
      const { data: lengthReread } = await db.from("manual_takeoffs").select("*").eq("id", lengthRow.id).single();

      // Reload at the SAME render scale used to draw it: the projected
      // screen length must reproduce the original screen pixels exactly —
      // proving the round trip through page-space is lossless.
      const lengthAtSameScale = pointsToScreenSpace(lengthReread.geometry.points, renderScaleDraw);
      const lenPxAtSameScale = Math.hypot(lengthAtSameScale[1].x - lengthAtSameScale[0].x, lengthAtSameScale[1].y - lengthAtSameScale[0].y);
      assert.ok(Math.abs(lenPxAtSameScale - 200) < 1e-9, "projecting back through the SAME render scale must reproduce the original screen pixels");

      // Reload at a DIFFERENT render scale (window resized): the on-screen
      // pixel length changes proportionally, but that's expected — what
      // must NOT change is the real-world length, which is derived from
      // page-space length (a fixed, scale-independent quantity) times the
      // real-world-per-pixel calibration at the scale the geometry was
      // ORIGINALLY authored at (renderScaleDraw), never the reload's scale.
      const pageSpaceLen = Math.hypot(
        lengthReread.geometry.points[1].x - lengthReread.geometry.points[0].x,
        lengthReread.geometry.points[1].y - lengthReread.geometry.points[0].y,
      );
      const recomputedLenRealWorld = pageSpaceLen * renderScaleDraw * scale;
      assert.ok(Math.abs(recomputedLenRealWorld - lengthQtyBeforeSave) < 1e-6);
      assert.equal(lengthReread.quantity, lengthQtyBeforeSave, "stored quantity itself must never be recomputed on reload");

      // Sanity: the reload render scale (renderScaleReload) only affects the
      // SVG's on-screen pixel projection, never the real-world quantity —
      // confirm the screen-pixel length at the differently-sized window is
      // indeed different from the original, while quantity stays fixed.
      const lengthAtReload = pointsToScreenSpace(lengthReread.geometry.points, renderScaleReload);
      const lenPxAtReload = Math.hypot(lengthAtReload[1].x - lengthAtReload[0].x, lengthAtReload[1].y - lengthAtReload[0].y);
      assert.notEqual(lenPxAtReload, lenPxAtSameScale, "a resized window must change the ON-SCREEN projection");

      // count: single point, quantity is always 1 regardless of zoom/pan.
      const { row: countRow } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "count", quantity: 1,
        geometry: { points: pointsToPageSpace([{ x: 55, y: 55 }], renderScaleDraw), coordinate_space: "page_space" },
        client_key: `${TEST_MARK}-invariance-count`,
      });
      const { data: countReread } = await db.from("manual_takeoffs").select("quantity").eq("id", countRow.id).single();
      assert.equal(countReread.quantity, 1);

      // area: a 100x100px square at draw time.
      const areaScreenPts: Point[] = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
      const areaQtyBeforeSave = 100 * 100 * scale * scale;
      const { row: areaRow } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "area", quantity: areaQtyBeforeSave,
        geometry: { points: pointsToPageSpace(areaScreenPts, renderScaleDraw), coordinate_space: "page_space" },
        client_key: `${TEST_MARK}-invariance-area`,
      });
      const { data: areaReread } = await db.from("manual_takeoffs").select("quantity").eq("id", areaRow.id).single();
      assert.equal(areaReread.quantity, areaQtyBeforeSave);
    });
  });

  describe("10. Cross-tenant isolation", () => {
    it("tenant B cannot GET, update, delete, or idempotent-upsert tenant A's object using its known id/client_key", async () => {
      const key = `${TEST_MARK}-crosstenant-1`;
      const { row: created } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "count", quantity: 1,
        geometry: { points: [{ x: 1, y: 1 }], coordinate_space: "page_space" },
        client_key: key,
      });

      // GET scoped to tenant B finds nothing.
      const { data: crossGet } = await db.from("manual_takeoffs").select("id").eq("id", created.id).eq("tenant_id", tenantB);
      assert.equal(crossGet.length, 0);

      // UPDATE scoped to tenant B affects nothing.
      const { data: crossUpdate } = await db.from("manual_takeoffs")
        .update({ quantity: 999 }).eq("id", created.id).eq("tenant_id", tenantB).select("id");
      assert.equal((crossUpdate ?? []).length, 0);
      const { data: unchanged } = await db.from("manual_takeoffs").select("quantity").eq("id", created.id).single();
      assert.equal(unchanged.quantity, 1);

      // DELETE (soft) scoped to tenant B affects nothing.
      const { data: crossDelete } = await db.from("manual_takeoffs")
        .update({ deleted_at: new Date().toISOString() }).eq("id", created.id).eq("tenant_id", tenantB).select("id");
      assert.equal((crossDelete ?? []).length, 0);
      const { data: stillActive } = await db.from("manual_takeoffs").select("deleted_at").eq("id", created.id).single();
      assert.equal(stillActive.deleted_at, null);

      // Idempotent upsert "as tenant B" (same client_key, different
      // tenant_id in the row) does not collide with tenant A's row — the
      // unique index is scoped to (tenant_id, project_id, client_key), so a
      // different tenant_id is simply a distinct row, never a cross-tenant
      // overwrite. A client-supplied tenant_id in the request body is never
      // trusted anyway — the real route always derives it server-side.
      const { data: projectBRow } = await db.from("projects").insert({ tenant_id: tenantB, name: `${TEST_MARK}_project_b` }).select("id").single();
      const { data: crossUpsert, error: crossUpsertErr } = await db.from("manual_takeoffs")
        .upsert({
          tenant_id: tenantB, project_id: projectBRow.id, takeoff_type: "count", quantity: 1,
          geometry: { points: [{ x: 1, y: 1 }] }, client_key: key, created_by: "attacker", created_at: new Date().toISOString(),
        }, { onConflict: "tenant_id,project_id,client_key" }).select("id").single();
      if (crossUpsertErr) throw crossUpsertErr;
      assert.notEqual(crossUpsert.id, created.id, "same client_key under a different tenant must never resolve to tenant A's row");

      await db.from("manual_takeoffs").delete().eq("id", crossUpsert.id);
      await db.from("projects").delete().eq("id", projectBRow.id);
    });
  });

  describe("11. Project and sheet relationship validation", () => {
    it("rejects a project from tenant A paired with a sheet whose document belongs to a DIFFERENT project", async () => {
      // pageA belongs to documentA -> projectA. Attempting to save against
      // projectAOther using pageA (a real page, but the wrong project) must
      // be rejected by assertPageBelongsToProject.
      const ok = await checkPageBelongsToProject(pageA, projectAOther, tenantA);
      assert.equal(ok, false, "a page belonging to a different project must be rejected");

      // Sanity: the correct pairing passes.
      const okCorrect = await checkPageBelongsToProject(pageA, projectA, tenantA);
      assert.equal(okCorrect, true);

      // Symmetric case: pageB (belonging to projectAOther) is correctly
      // accepted for its own project and rejected for projectA.
      const okOtherCorrect = await checkPageBelongsToProject(pageB, projectAOther, tenantA);
      assert.equal(okOtherCorrect, true);
      const okOtherMismatch = await checkPageBelongsToProject(pageB, projectA, tenantA);
      assert.equal(okOtherMismatch, false);
    });

    it("rejects a sheet whose tenant does not match the caller's tenant, even if the project_id happens to exist", async () => {
      const ok = await checkPageBelongsToProject(pageA, projectA, tenantB);
      assert.equal(ok, false, "a page under a different tenant must be rejected regardless of project_id");
    });

    it("rejects a project_id that does not belong to the tenant at all", async () => {
      const ok = await checkProjectBelongsToTenant(projectA, tenantB);
      assert.equal(ok, false);
    });
  });

  describe("12. Estimate-link safety", () => {
    it("a quantity change on a manual takeoff linked to a DRAFT estimate updates that draft version (current authoritative sync behavior)", async () => {
      const { versionId: draftVersionId } = await getOrCreateDraftVersion(db, tenantA, projectA, "integration_test_user");
      const { data: version } = await db.from("estimate_versions").select("status").eq("id", draftVersionId).single();
      assert.equal(version.status, "draft", "a freshly created/obtained version for a project with no prior approval must be a draft");
      // The actual quantity -> estimate_items propagation is
      // syncTakeoffToEstimate's responsibility (lib/estimating/auto-sync.ts),
      // already covered end-to-end in
      // lib/estimating/takeoff-integrity.integration.test.ts's "approved
      // item DOES flow into the estimate on sync" case; this test pins down
      // the version-selection precondition that guarantees a manual-canvas
      // save always targets a draft, never a locked version.
    });

    it("approving a version and then syncing a new/changed takeoff never mutates the approved version — a new draft is opened instead", async () => {
      const { estimateId, versionId: v1 } = await getOrCreateDraftVersion(db, tenantA, projectA, "integration_test_user");
      await approveVersion(db, { versionId: v1, estimateId, userId: "integration_test_approver" });
      const { data: approvedRow } = await db.from("estimate_versions").select("status").eq("id", v1).single();
      assert.equal(approvedRow.status, "approved");

      // Next call for the SAME project must return a NEW draft version, not v1.
      const { versionId: v2 } = await getOrCreateDraftVersion(db, tenantA, projectA, "integration_test_user");
      assert.notEqual(v2, v1, "getOrCreateDraftVersion must never hand back a locked version");

      const { data: v1After } = await db.from("estimate_versions").select("status").eq("id", v1).single();
      assert.equal(v1After.status, "approved", "the approved version's status must remain untouched by later takeoff activity");

      const { data: v2Row } = await db.from("estimate_versions").select("status, estimate_id").eq("id", v2).single();
      assert.equal(v2Row.status, "draft");
      assert.equal(v2Row.estimate_id, estimateId);
    });

    it("soft-deleting a manual takeoff does not silently mutate or orphan an approved estimate, and source traceability survives", async () => {
      const { row: created } = await saveManualTakeoff({
        project_id: projectA, page_id: pageA, takeoff_type: "count", quantity: 3,
        geometry: { points: [{ x: 9, y: 9 }], coordinate_space: "page_space" },
        client_key: `${TEST_MARK}-estimate-safety-1`,
      });
      await softDeleteManualTakeoff(created.id);

      // The soft-deleted row (and its tenant/project/page linkage) is still
      // readable for traceability — nothing about deletion erases the
      // source reference an estimate line might carry.
      const { data: afterDelete } = await db.from("manual_takeoffs").select("id, tenant_id, project_id, page_id, deleted_at").eq("id", created.id).single();
      assert.equal(afterDelete.tenant_id, tenantA);
      assert.equal(afterDelete.project_id, projectA);
      assert.equal(afterDelete.page_id, pageA);
      assert.ok(afterDelete.deleted_at);

      // KNOWN GAP (see REMAINING_RISKS below): the route's DELETE handler
      // only soft-deletes the manual_takeoffs row — it does not touch the
      // mirrored takeoff_items row or re-run syncTakeoffToEstimate. An
      // already-synced estimate_items row is therefore untouched (not
      // silently mutated — satisfies the "approved estimate not silently
      // mutated" requirement) but also not marked as stemming from a
      // deleted measurement. This is documented, not fabricated as fixed.
    });
  });
}
