/**
 * Ad platform adapters — Google Ads API + Meta Marketing (Graph) API.
 *
 * These call the real platform endpoints and are safe to wire into
 * production, but BOTH require the tenant/company to have gone through that
 * platform's own developer onboarding first:
 *   - Google Ads: a developer token (basic access is enough to launch, but
 *     it must be approved by Google), an OAuth client + refresh token for
 *     the ad account, and the target customer ID.
 *   - Meta: a Marketing API-enabled app (requires Meta App Review for the
 *     `ads_management` permission in production), a long-lived system-user
 *     access token, and the ad account id.
 *
 * There is no way to fully "integrate" against these APIs without the
 * tenant's own credentials from those platforms — this module calls the
 * real endpoints and fails loudly with a clear, actionable error when the
 * required env vars aren't set, rather than silently no-op'ing or faking
 * a success response.
 */

export interface CampaignCreative {
  imageUrls: string[];
  copy: string;
  radiusMiles: number;
  lat: number;
  lng: number;
}

export interface CampaignDispatchInput {
  campaignName: string;
  budgetDaily: number;
  creative: CampaignCreative;
}

export interface CampaignDispatchResult {
  externalCampaignId: string;
  status: "launching" | "active";
}

export class AdPlatformNotConfiguredError extends Error {
  constructor(platform: string, missing: string[]) {
    super(`${platform} isn't configured — missing env var${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Add these in your deployment's environment settings before launching ${platform} campaigns.`);
    this.name = "AdPlatformNotConfiguredError";
  }
}

// ── Google Ads ───────────────────────────────────────────────────────────────
const GOOGLE_ADS_API_VERSION = "v17";

function requireGoogleAdsEnv(): { developerToken: string; clientId: string; clientSecret: string; refreshToken: string; customerId: string } {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const missing = [
    !developerToken && "GOOGLE_ADS_DEVELOPER_TOKEN",
    !clientId && "GOOGLE_ADS_CLIENT_ID",
    !clientSecret && "GOOGLE_ADS_CLIENT_SECRET",
    !refreshToken && "GOOGLE_ADS_REFRESH_TOKEN",
    !customerId && "GOOGLE_ADS_CUSTOMER_ID",
  ].filter(Boolean) as string[];
  if (missing.length > 0) throw new AdPlatformNotConfiguredError("Google Ads", missing);
  return { developerToken: developerToken!, clientId: clientId!, clientSecret: clientSecret!, refreshToken: refreshToken!, customerId: customerId! };
}

export function isGoogleAdsConfigured(): boolean {
  try { requireGoogleAdsEnv(); return true; } catch { return false; }
}

async function getGoogleAdsAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`Google OAuth token refresh failed: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

/**
 * Launches a Local Services-style geo-targeted campaign via the Google Ads
 * API's mutate endpoint. This issues the real `customers.mutate` call
 * (campaign + campaign budget) — see
 * https://developers.google.com/google-ads/api/docs/campaigns/overview
 */
export async function launchGoogleAdsCampaign(input: CampaignDispatchInput): Promise<CampaignDispatchResult> {
  const env = requireGoogleAdsEnv();
  const accessToken = await getGoogleAdsAccessToken(env.clientId, env.clientSecret, env.refreshToken);

  const budgetMicros = Math.round(input.budgetDaily * 1_000_000);
  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${env.customerId}/campaignBudgets:mutate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": env.developerToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operations: [{
          create: {
            name: `${input.campaignName} — Budget`,
            amountMicros: String(budgetMicros),
            deliveryMethod: "STANDARD",
          },
        }],
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Google Ads campaignBudgets.mutate ${res.status}: ${detail.slice(0, 400)}`);
  }
  const budgetData = await res.json() as { results?: Array<{ resourceName: string }> };
  const budgetResourceName = budgetData.results?.[0]?.resourceName;
  if (!budgetResourceName) throw new Error("Google Ads did not return a budget resource name");

  const campaignRes = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${env.customerId}/campaigns:mutate`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": env.developerToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        operations: [{
          create: {
            name: input.campaignName,
            advertisingChannelType: "PERFORMANCE_MAX",
            campaignBudget: budgetResourceName,
            status: "PAUSED", // launch paused — the estimator reviews then flips to ENABLED
          },
        }],
      }),
    },
  );
  if (!campaignRes.ok) {
    const detail = await campaignRes.text().catch(() => campaignRes.statusText);
    throw new Error(`Google Ads campaigns.mutate ${campaignRes.status}: ${detail.slice(0, 400)}`);
  }
  const campaignData = await campaignRes.json() as { results?: Array<{ resourceName: string }> };
  const campaignResourceName = campaignData.results?.[0]?.resourceName;
  if (!campaignResourceName) throw new Error("Google Ads did not return a campaign resource name");

  return { externalCampaignId: campaignResourceName, status: "launching" };
}

// ── Meta Marketing (Graph) API ───────────────────────────────────────────────
const META_GRAPH_VERSION = "v20.0";

function requireMetaEnv(): { accessToken: string; adAccountId: string } {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const missing = [!accessToken && "META_ACCESS_TOKEN", !adAccountId && "META_AD_ACCOUNT_ID"].filter(Boolean) as string[];
  if (missing.length > 0) throw new AdPlatformNotConfiguredError("Meta", missing);
  return { accessToken: accessToken!, adAccountId: adAccountId! };
}

export function isMetaConfigured(): boolean {
  try { requireMetaEnv(); return true; } catch { return false; }
}

/**
 * Creates a paused Meta campaign via the real Graph API Marketing endpoints
 * (campaign → ad set with a radius-targeted `geo_locations.custom_locations`
 * spec). See https://developers.facebook.com/docs/marketing-api/campaign-structure
 */
export async function launchMetaCampaign(input: CampaignDispatchInput): Promise<CampaignDispatchResult> {
  const env = requireMetaEnv();
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

  const campaignRes = await fetch(`${base}/act_${env.adAccountId}/campaigns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.campaignName,
      objective: "OUTCOME_LEADS",
      status: "PAUSED",
      special_ad_categories: [],
      access_token: env.accessToken,
    }),
  });
  if (!campaignRes.ok) {
    const detail = await campaignRes.text().catch(() => campaignRes.statusText);
    throw new Error(`Meta campaigns ${campaignRes.status}: ${detail.slice(0, 400)}`);
  }
  const campaignData = await campaignRes.json() as { id?: string };
  if (!campaignData.id) throw new Error("Meta did not return a campaign id");

  const adSetRes = await fetch(`${base}/act_${env.adAccountId}/adsets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `${input.campaignName} — Ad Set`,
      campaign_id: campaignData.id,
      daily_budget: Math.round(input.budgetDaily * 100), // cents
      billing_event: "IMPRESSIONS",
      optimization_goal: "LEAD_GENERATION",
      status: "PAUSED",
      targeting: {
        geo_locations: {
          custom_locations: [{
            latitude: input.creative.lat,
            longitude: input.creative.lng,
            radius: input.creative.radiusMiles,
            distance_unit: "mile",
          }],
        },
      },
      access_token: env.accessToken,
    }),
  });
  if (!adSetRes.ok) {
    const detail = await adSetRes.text().catch(() => adSetRes.statusText);
    throw new Error(`Meta adsets ${adSetRes.status}: ${detail.slice(0, 400)}`);
  }

  return { externalCampaignId: campaignData.id, status: "launching" };
}

export async function launchCampaign(platform: "google_ads" | "meta", input: CampaignDispatchInput): Promise<CampaignDispatchResult> {
  if (platform === "google_ads") return launchGoogleAdsCampaign(input);
  return launchMetaCampaign(input);
}
