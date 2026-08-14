import { expect, test } from "@playwright/test";

test("reviews and confirms exact price evidence before it becomes eligible", async ({ page }) => {
  let confirmationBody: Record<string, unknown> | null = null;
  await page.route("**/api/cost-catalog", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/projects?limit=200", (route) => route.fulfill({ json: { projects: [] } }));
  await page.route("**/api/construction-intelligence/prices/review-queue", (route) => route.fulfill({ json: { observations: [{
    id: "11111111-1111-4111-8111-111111111111", description: "Concrete supply", cost_code: "03-30-00",
    source_kind: "project_quote", source_ref: "Quote Q-1042", effective_date: "2026-08-14", unit: "CY",
    labor_cost: 10, material_cost: 150, equipment_cost: 5, subcontract_cost: 0, other_cost: 0,
    tax_cost: 0, freight_cost: 10, waste_cost: 0, escalation_cost: 0, confidence: 0.95,
  }] } }));
  await page.route("**/api/construction-intelligence/prices/11111111-1111-4111-8111-111111111111/review", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body.confirm === true) {
      confirmationBody = body;
      await route.fulfill({ json: { observation: { id: "11111111-1111-4111-8111-111111111111", approval_status: "approved" } } });
      return;
    }
    await route.fulfill({ json: { preview: { id: "22222222-2222-4222-8222-222222222222", payload_hash: "a".repeat(64) } } });
  });

  await page.goto("/e2e/pricebook");
  await expect(page.getByText("Concrete supply")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Quote Q-1042");
  await expect(page.getByRole("dialog")).toContainText("$175.00/CY");
  await page.getByRole("button", { name: "Approve evidence" }).click();
  await expect.poll(() => confirmationBody).toEqual({
    confirm: true, preview_id: "22222222-2222-4222-8222-222222222222", preview_hash: "a".repeat(64),
  });
});
