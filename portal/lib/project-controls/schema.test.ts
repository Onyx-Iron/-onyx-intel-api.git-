import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildChangeOrderPayload,
  buildChangeOrderUpdate,
  buildRfiPayload,
  buildRfiUpdate,
  buildSubmittalPayload,
  buildSubmittalUpdate,
  controlWriteStatus,
  getControlSummary,
  rfiRawWithSubject,
} from "./schema.ts";

const scope = {
  tenantId: "tenant-1",
  projectId: "project-1",
};

describe("project control payloads", () => {
  it("normalizes an RFI payload without losing required construction context", () => {
    const payload = buildRfiPayload(
      {
        number: " RFI-004 ",
        subject: "  Confirm water tie-in elevation  ",
        description: "  Need civil response before excavation.  ",
        discipline: "",
        status: "not-a-status",
        priority: "critical",
        due_date: "2026-07-15",
        assigned_to: "  Civil Engineer  ",
        response: "",
      },
      scope,
    );

    assert.deepEqual(payload, {
      tenant_id: "tenant-1",
      project_id: "project-1",
      number: "RFI-004",
      subject: "Confirm water tie-in elevation",
      description: "Need civil response before excavation.",
      discipline: null,
      status: "open",
      priority: "critical",
      submitted_date: null,
      due_date: "2026-07-15",
      assigned_to: "Civil Engineer",
      response: null,
      response_date: null,
      meta: {},
    });
  });

  it("normalizes submittal and change-order money fields consistently", () => {
    const submittal = buildSubmittalPayload(
      {
        number: "SUB-8",
        title: "PVC pipe product data",
        submittal_type: "product_data",
        status: "submitted",
        revision: "  Rev 2 ",
      },
      scope,
    );

    const changeOrder = buildChangeOrderPayload(
      {
        number: "CO-3",
        description: "Additional rock excavation",
        status: "pending",
        amount: "12500.50",
        markup: "",
      },
      scope,
    );

    assert.equal(submittal.revision, "Rev 2");
    assert.equal(submittal.status, "submitted");
    assert.equal(changeOrder.amount, 12500.5);
    assert.equal(changeOrder.markup, null);
    assert.equal(changeOrder.cost_code, null);
  });

  it("accepts an RFI title as the stored subject", () => {
    const payload = buildRfiPayload(rfiRawWithSubject({ title: "  Confirm sleeve elevation  " }), scope);
    assert.equal(payload.subject, "Confirm sleeve elevation");
  });

  it("stores a change-order cost code the budget can group", () => {
    const payload = buildChangeOrderPayload({
      description: "Added hydrant",
      cost_code: "33-11-00",
      amount: 4200,
      status: "approved",
    }, scope);
    assert.equal(payload.cost_code, "33-11-00");
    assert.equal(payload.status, "approved");
    assert.equal(payload.amount, 4200);
  });

  it("reserves 503 for a missing table and 422 for any other insert error", () => {
    assert.equal(controlWriteStatus({ code: "PGRST205", message: "Could not find the table" }), 503);
    assert.equal(controlWriteStatus({ code: "23514", message: "check constraint failed" }), 422);
  });

  it("summarizes open controls and pending cost exposure", () => {
    const summary = getControlSummary({
      rfis: [
        { status: "open" },
        { status: "answered" },
        { status: "closed" },
      ],
      submittals: [
        { status: "submitted" },
        { status: "approved" },
        { status: "revise_resubmit" },
      ],
      changeOrders: [
        { status: "pending", amount: 5000 },
        { status: "approved", amount: 1000 },
        { status: "draft", amount: null },
      ],
    });

    assert.deepEqual(summary, {
      rfis_open: 2,
      submittals_open: 2,
      change_orders_pending: 1,
      change_orders_approved: 1,
      pending_change_order_value: 5000,
      approved_change_order_value: 1000,
    });
  });

  it("normalizes partial updates without requiring full forms", () => {
    assert.deepEqual(buildRfiUpdate({ status: "answered", response: "  See C2.1  " }), {
      status: "answered",
      response: "See C2.1",
    });

    assert.deepEqual(buildSubmittalUpdate({ status: "approved_as_noted", returned_date: "2026-07-21" }), {
      status: "approved_as_noted",
      returned_date: "2026-07-21",
    });

    assert.deepEqual(buildChangeOrderUpdate({ status: "approved", amount: "1300", markup: "" }), {
      status: "approved",
      amount: 1300,
      markup: null,
    });
  });
});
