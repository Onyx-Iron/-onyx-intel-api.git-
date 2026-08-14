import { expect, test } from "@playwright/test";

test("shows truthful scope, conflict, review lock, and AI warning", async ({ page }) => {
  await page.route("**/api/construction-intelligence/scope**", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      divisions: [{ code: "08", name: "Openings", family: "Architectural" }],
      latest: { id: "scope-1", mode: "selected_trades", division_codes: ["08"] },
    }),
  }));
  await page.route("**/api/takeoff/jobs**", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ jobs: [{
      id: "job-1", state: "conflicted", created_at: new Date().toISOString(), scope_snapshot: { mode: "trades" },
      units: [{ id: "unit-1", unit_type: "page", source_id: "page-1", state: "conflicted", attempt_count: 1, last_error: "Revision requires acceptance" }],
      candidate_summary: { total: 1, validated: 0, blocked: 1, pending_approval: 1 },
    }] }),
  }));
  await page.route("**/api/takeoff/items**", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [{
      id: "candidate-1", label: "Type A hollow metal door", csi_code: "08-11-00",
      quantity: 12, unit: "EA", review_status: "suggested", takeoff_job_id: "job-1",
      quantity_validation_status: "blocked", quantity_validation_reason: "stale_revision",
      source_manifest_version: 2, is_stale: true,
      meta: { quantity_basis: "Door schedule Qty 12", extraction_method: "deterministic" },
    }] }),
  }));
  await page.route("**/api/documents**", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ documents: [] }) }));

  await page.goto("/e2e/takeoff");

  await expect(page.getByText("Processing scope", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Automated takeoff status").getByText("Conflicted revision", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve and import" })).toBeDisabled();
  await expect(page.getByText(/AI can make mistakes/i).first()).toBeVisible();
  await expect(page.getByText("1 quantity awaiting resolution", { exact: true })).toBeVisible();
  await expect(page.getByText("0 of 1 units resolved", { exact: true })).toBeVisible();
});

test("creates an immutable preview, confirms it, and imports a ready quantity", async ({ page }) => {
  await page.route("**/api/version", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: "e2e" }) }));
  await page.route("**/api/construction-intelligence/scope**", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ divisions: [], latest: { id: "scope-1", mode: "all_scopes", division_codes: [] } }),
  }));
  await page.route("**/api/takeoff/jobs**", async (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ jobs: [{ id: "job-1", state: "review_ready", created_at: new Date().toISOString(), scope_snapshot: { mode: "complete" } }] }),
  }));
  let imported = false;
  await page.route("**/api/takeoff/items?**", async (route) => {
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ items: [{
        id: "candidate-1", label: "Type A hollow metal door", csi_code: "08-11-00",
        quantity: 12, unit: "EA", review_status: imported ? "approved" : "suggested",
        takeoff_job_id: "job-1", quantity_validation_status: "validated", is_stale: false,
        meta: { quantity_basis: "Door schedule Qty 12", extraction_method: "deterministic" },
      }] }),
    });
  });
  await page.route("**/api/documents**", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ documents: [] }) }));
  let previewCalls = 0;
  let confirmationCalls = 0;
  let importCalls = 0;
  await page.route("**/api/takeoff/approval-preview", async (route) => {
    previewCalls += 1;
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ projectId: "00000000-0000-4000-8000-000000000001", jobId: "job-1", candidateIds: ["candidate-1"] });
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ preview: { id: "preview-1" } }) });
  });
  await page.route("**/api/takeoff/approval-preview/preview-1/confirm", async (route) => {
    confirmationCalls += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ approval: { id: "approval-1" } }) });
  });
  await page.route("**/api/estimate/import-takeoff", async (route) => {
    importCalls += 1;
    imported = true;
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ preview_id: "preview-1", idempotency_key: "takeoff-preview:preview-1" });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ created: 1 }) });
  });

  await page.goto("/e2e/takeoff");
  const approve = page.getByRole("button", { name: "Approve and import" });
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect.poll(() => ({ previewCalls, confirmationCalls, importCalls })).toEqual({ previewCalls: 1, confirmationCalls: 1, importCalls: 1 });
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
});
