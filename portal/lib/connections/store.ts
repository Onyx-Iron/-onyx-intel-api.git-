import { createServiceClient } from "@/lib/supabase/server";
import { isConnected as googleIsConnected } from "@/lib/google/oauth";

export type HubProvider =
  | "google"
  | "dropbox"
  | "sharefile"
  | "meta"
  | "gbp"
  | "gsc"
  | "linkedin"
  | "icloud";

export interface ConnectionChip {
  provider: HubProvider;
  label: string;
  connected: boolean;
  accountLabel?: string | null;
  status?: string;
  statusDetail?: string | null;
  supportsOAuth: boolean;
  note?: string;
}

const HUB_LABELS: Record<HubProvider, string> = {
  google: "Google (Drive / Gmail / Calendar)",
  dropbox: "Dropbox",
  sharefile: "ShareFile",
  meta: "Meta (Facebook / Instagram)",
  gbp: "Google Business Profile",
  gsc: "Google Search Console",
  linkedin: "LinkedIn",
  icloud: "iCloud Drive",
};

export async function listConnectionChips(
  tenantId: string,
  userId: string,
): Promise<ConnectionChip[]> {
  const google = await googleIsConnected(tenantId, userId);
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (db as any)
    .from("tenant_connections")
    .select("provider, status, status_detail, external_account_label")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);

  const byProvider = new Map<string, {
    status: string;
    status_detail: string | null;
    external_account_label: string | null;
  }>();
  for (const r of (rows ?? []) as Array<{
    provider: string;
    status: string;
    status_detail: string | null;
    external_account_label: string | null;
  }>) {
    byProvider.set(r.provider, r);
  }

  const oauthProviders: HubProvider[] = [
    "dropbox", "sharefile", "meta", "gbp", "gsc", "linkedin",
  ];

  const chips: ConnectionChip[] = [
    {
      provider: "google",
      label: HUB_LABELS.google,
      connected: !!google.connected,
      accountLabel: google.email ?? null,
      status: google.connected ? "connected" : "disconnected",
      supportsOAuth: true,
    },
  ];

  for (const p of oauthProviders) {
    const row = byProvider.get(p);
    chips.push({
      provider: p,
      label: HUB_LABELS[p],
      connected: row?.status === "connected",
      accountLabel: row?.external_account_label ?? null,
      status: row?.status ?? "disconnected",
      statusDetail: row?.status_detail ?? null,
      supportsOAuth: true,
    });
  }

  chips.push({
    provider: "icloud",
    label: HUB_LABELS.icloud,
    connected: false,
    supportsOAuth: false,
    note: "Apple provides no third-party iCloud Drive API for web. Use Upload or Email import.",
  });

  return chips;
}

export async function disconnectHubProvider(
  tenantId: string,
  userId: string,
  provider: HubProvider,
): Promise<void> {
  if (provider === "google") {
    const db = await createServiceClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await db.from("google_connections" as any)
      .delete()
      .eq("tenant_id", tenantId)
      .eq("user_id", userId);
    return;
  }
  if (provider === "icloud") return;

  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .from("tenant_connections")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("provider", provider);
}

export async function upsertTenantConnection(params: {
  tenantId: string;
  userId: string;
  provider: Exclude<HubProvider, "google" | "icloud">;
  accessToken?: string | null;
  refreshToken?: string | null;
  accessExpiresAt?: string | null;
  scopes?: string | null;
  externalAccountLabel?: string | null;
  externalAccountId?: string | null;
  status?: string;
  statusDetail?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).from("tenant_connections").upsert({
    tenant_id: params.tenantId,
    user_id: params.userId,
    provider: params.provider,
    access_token: params.accessToken ?? null,
    refresh_token: params.refreshToken ?? null,
    access_expires_at: params.accessExpiresAt ?? null,
    scopes: params.scopes ?? null,
    external_account_label: params.externalAccountLabel ?? null,
    external_account_id: params.externalAccountId ?? null,
    status: params.status ?? "connected",
    status_detail: params.statusDetail ?? null,
    meta: params.meta ?? {},
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,user_id,provider" });
}

export async function getTenantConnectionAccessToken(
  tenantId: string,
  userId: string,
  provider: Exclude<HubProvider, "google" | "icloud">,
): Promise<{ token: string | null; status: string; detail?: string | null }> {
  const db = await createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("tenant_connections")
    .select("access_token, refresh_token, access_expires_at, status, status_detail")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (!data) return { token: null, status: "disconnected" };
  if (data.status === "error" || data.status === "revoked") {
    return { token: null, status: data.status, detail: data.status_detail };
  }
  return { token: data.access_token ?? null, status: data.status };
}
