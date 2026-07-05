"use client";

import InvoiceListTab from "./_InvoiceListTab";

export default function AccountsReceivableTab({ projectId }: { projectId: string }) {
  return (
    <InvoiceListTab
      projectId={projectId}
      direction="receivable"
      title="Accounts Receivable"
      counterpartyLabel="Customer"
      defaultFormDirection="receivable"
    />
  );
}
