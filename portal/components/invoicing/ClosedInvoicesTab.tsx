"use client";

import InvoiceListTab from "./_InvoiceListTab";

export default function ClosedInvoicesTab({ projectId }: { projectId: string }) {
  return (
    <InvoiceListTab
      projectId={projectId}
      statusFilter="closed"
      title="Closed Invoices"
      counterpartyLabel="Vendor / Customer"
      defaultFormDirection="receivable"
    />
  );
}
