import { expect, test } from "@playwright/test";

test("previews and confirms the exact governed estimate version", async ({ page }) => {
  let approvalBody: Record<string, unknown> | null = null;
  await page.route("**/api/project-controls/role", (route) => route.fulfill({ json: { role: "Estimator" } }));
  await page.route("**/api/estimate/versions?project_id=project-e2e", (route) => route.fulfill({
    json: { estimate: { id: "estimate-1", current_version_id: "version-1" }, versions: [{ id: "version-1", version_number: 1, status: "draft" }] },
  }));
  await page.route("**/api/estimate/versions/version-1", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ json: { items: [], totals: {}, version: { id: "version-1", status: "draft" } } });
      return;
    }
    await route.fulfill({ json: {
      version: { id: "version-1", version_number: 1, status: "draft", row_version: 4, contingency_pct: 5, overhead_pct: 10, profit_pct: 15 },
      items: [{
        id: "item-1", row_version: 0, cost_code: "03-30-00", description: "Concrete slab", quantity: 100, uom: "SF",
        labor_cost: 200, material_cost: 700, equipment_cost: 100, trucking_cost: 0, subcontract_cost: 0,
        disposal_cost: 0, notes: "", sort_order: 0,
      }],
      totals: { totalPrice: 1328.25 },
    } });
  });
  await page.route("**/api/estimate/versions/version-1/approval-preview", (route) => route.fulfill({
    status: 201,
    json: { preview: { id: "preview-1", payload: { totals: { totalPrice: 1328.25 } } } },
  }));
  await page.route("**/api/estimate/versions/version-1/approve", async (route) => {
    approvalBody = route.request().postDataJSON();
    await route.fulfill({ json: { version: { id: "version-1", status: "approved" } } });
  });

  await page.goto("/e2e/estimate");
  await expect(page.getByText("E2E Project")).toBeVisible();
  await page.getByRole("button", { name: "Approve Version" }).click();
  await expect(page.getByRole("dialog")).toContainText("approving the exact current estimate totaling $1,328.25");
  await page.getByRole("button", { name: "Approve exact version" }).click();
  await expect.poll(() => approvalBody).toEqual({ preview_id: "preview-1" });
});
