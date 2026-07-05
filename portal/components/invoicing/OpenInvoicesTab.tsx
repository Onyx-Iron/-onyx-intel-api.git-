"use client";

import InvoiceListTab from "./_InvoiceListTab";

export default function OpenInvoicesTab({ projectId }: { projectId: string }) {
  return (
    <InvoiceListTab
      projectId={projectId}
      statusFilter="open"
      title="Open Invoices"
      counterpartyLabel="Vendor / Customer"
      showAging
      defaultFormDirection="receivable"
    />
  );
}
