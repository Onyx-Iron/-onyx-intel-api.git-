import type { Metadata } from "next";
import LegalPage from "@/components/legal/LegalPage";

export const metadata: Metadata = { title: "Privacy Notice | OnyxIntel" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Notice" effectiveDate="August 14, 2026">
      <section><h2>Information we process</h2><p>OnyxIntel processes account and organization identifiers, role and access settings, project records, uploaded files, estimates, takeoffs, field records, communications you initiate, integration metadata, billing status, audit events, device and diagnostic information, and support requests.</p></section>
      <section><h2>How information is used</h2><ul><li>Provide, secure, troubleshoot, and improve the service.</li><li>Process documents and generate user-requested analysis.</li><li>Maintain tenant isolation, permissions, approvals, audit history, and recovery.</li><li>Administer subscriptions, prevent abuse, and meet legal obligations.</li></ul></section>
      <section><h2>AI processing</h2><p>When you invoke an AI feature, the relevant prompt and project content may be sent to the configured AI provider to produce the requested result. OnyxIntel limits this processing to the feature being used and records provenance where the workflow requires it. Do not submit information your organization is not authorized to process.</p></section>
      <section><h2>Service providers and integrations</h2><p>OnyxIntel uses contracted infrastructure, authentication, database, storage, hosting, billing, observability, and AI providers. Optional integrations such as Google Workspace are used only when connected and authorized. Providers process information under their own contractual and security obligations.</p></section>
      <section><h2>Sharing</h2><p>We do not sell project content. Information may be shared with authorized workspace members, processors needed to operate the service, professional advisers, a successor in a business transaction, or authorities when legally required. Customer-directed exports and external communications are shared with the recipients the customer selects.</p></section>
      <section><h2>Retention and deletion</h2><p>Information is retained while needed to provide the service, preserve approved estimate and audit lineage, meet contractual or legal duties, resolve disputes, and maintain security. Workspace administrators may request export or deletion, subject to required backups, financial records, litigation holds, and other lawful retention.</p></section>
      <section><h2>Security</h2><p>OnyxIntel uses authentication, tenant isolation, role-based permissions, encryption provided by its infrastructure, audit logging, and controlled service access. No system can guarantee absolute security. Report suspected unauthorized access immediately through the official support channel.</p></section>
      <section><h2>Your choices</h2><p>You may review or update account information through the application and manage optional integrations in settings. Depending on applicable law, you may request access, correction, deletion, restriction, or a copy of personal information through your organization&apos;s administrator or the official support channel.</p></section>
      <section><h2>Children and changes</h2><p>OnyxIntel is a business service and is not directed to children. We may update this notice as the service or law changes; the effective date above identifies the current version.</p></section>
    </LegalPage>
  );
}
