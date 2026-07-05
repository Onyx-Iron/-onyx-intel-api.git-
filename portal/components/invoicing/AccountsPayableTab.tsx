"use client";

import InvoiceListTab from "./_InvoiceListTab";

export default function AccountsPayableTab({ projectId }: { projectId: string }) {
  return (
    <InvoiceListTab
      projectId={projectId}
      direction="payable"
      title="Accounts Payable"
      counterpartyLabel="Vendor"
      defaultFormDirection="payable"
    />
  );
}
