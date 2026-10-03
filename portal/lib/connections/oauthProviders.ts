import { headerSafe } from "@/lib/http";

export type OAuthHubProvider = "dropbox" | "sharefile" | "meta" | "gbp" | "gsc" | "linkedin";

export function getAppOrigin(): string {
  return (
    headerSafe(process.env.NEXT_PUBLIC_APP_URL) ||
    headerSafe(process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://app.onyx-iron.com"
  ).replace(/\/$/, "");
}

export function buildProviderAuthUrl(provider: OAuthHubProvider, state: string): string | null {
  const origin = getAppOrigin();
  const redirectUri = `${origin}/api/connections/${provider}/callback`;

  switch (provider) {
    case "dropbox": {
      const clientId = headerSafe(process.env.DROPBOX_APP_KEY);
      if (!clientId) return null;
      const p = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        token_access_type: "offline",
        state,
      });
      return `https://www.dropbox.com/oauth2/authorize?${p}`;
    }
    case "sharefile": {
      const clientId = headerSafe(process.env.SHAREFILE_CLIENT_ID);
      const subdomain = headerSafe(process.env.SHAREFILE_SUBDOMAIN) || "secure";
      if (!clientId) return null;
      const p = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        state,
      });
      return `https://${subdomain}.sharefile.com/oauth/authorize?${p}`;
    }
    case "meta": {
      const appId = headerSafe(process.env.META_APP_ID);
      if (!appId) return null;
      const p = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        state,
        scope: "pages_show_list,pages_manage_posts,instagram_basic,instagram_content_publish",
        response_type: "code",
      });
      return `https://www.facebook.com/v21.0/dialog/oauth?${p}`;
    }
    case "gbp":
    case "gsc": {
      const clientId = headerSafe(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
      if (!clientId) return null;
      const scopes = provider === "gsc"
        ? "https://www.googleapis.com/auth/webmasters.readonly"
        : "https://www.googleapis.com/auth/business.manage";
      const p = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: scopes,
        access_type: "offline",
        prompt: "consent",
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
    }
    case "linkedin": {
      const clientId = headerSafe(process.env.LINKEDIN_CLIENT_ID);
      if (!clientId) return null;
      const p = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
        scope: "openid profile w_member_social",
      });
      return `https://www.linkedin.com/oauth/v2/authorization?${p}`;
    }
    default:
      return null;
  }
}

export async function exchangeProviderCode(
  provider: OAuthHubProvider,
  code: string,
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number; label?: string }> {
  const origin = getAppOrigin();
  const redirectUri = `${origin}/api/connections/${provider}/callback`;

  if (provider === "dropbox") {
    const clientId = headerSafe(process.env.DROPBOX_APP_KEY);
    const clientSecret = headerSafe(process.env.DROPBOX_APP_SECRET);
    if (!clientId || !clientSecret) throw new Error("DROPBOX_APP_KEY/SECRET not configured");
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, grant_type: "authorization_code",
        client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
      }),
    });
    const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !data.access_token) throw new Error(data.error_description ?? "Dropbox token exchange failed");
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in, label: "Dropbox" };
  }

  if (provider === "sharefile") {
    const clientId = headerSafe(process.env.SHAREFILE_CLIENT_ID);
    const clientSecret = headerSafe(process.env.SHAREFILE_CLIENT_SECRET);
    const subdomain = headerSafe(process.env.SHAREFILE_SUBDOMAIN) || "secure";
    if (!clientId || !clientSecret) throw new Error("SHAREFILE_CLIENT_ID/SECRET not configured");
    const res = await fetch(`https://${subdomain}.sharefile.com/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, grant_type: "authorization_code",
        client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
      }),
    });
    const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !data.access_token) throw new Error(data.error ?? "ShareFile token exchange failed");
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in, label: "ShareFile" };
  }

  if (provider === "meta") {
    const appId = headerSafe(process.env.META_APP_ID);
    const appSecret = headerSafe(process.env.META_APP_SECRET);
    if (!appId || !appSecret) throw new Error("META_APP_ID/SECRET not configured");
    const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("client_secret", appSecret);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code", code);
    const res = await fetch(url.toString());
    const data = await res.json() as { access_token?: string; expires_in?: number; error?: { message?: string } };
    if (!res.ok || !data.access_token) throw new Error(data.error?.message ?? "Meta token exchange failed");
    return { accessToken: data.access_token, expiresIn: data.expires_in, label: "Meta" };
  }

  if (provider === "gbp" || provider === "gsc") {
    const clientId = headerSafe(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
    const clientSecret = headerSafe(process.env.GOOGLE_CLIENT_SECRET);
    if (!clientId || !clientSecret) throw new Error("Google OAuth client not configured");
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: "authorization_code",
      }),
    });
    const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !data.access_token) throw new Error(data.error_description ?? "Google token exchange failed");
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      label: provider === "gsc" ? "Search Console" : "Business Profile",
    };
  }

  if (provider === "linkedin") {
    const clientId = headerSafe(process.env.LINKEDIN_CLIENT_ID);
    const clientSecret = headerSafe(process.env.LINKEDIN_CLIENT_SECRET);
    if (!clientId || !clientSecret) throw new Error("LINKEDIN_CLIENT_ID/SECRET not configured");
    const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code,
        redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret,
      }),
    });
    const data = await res.json() as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !data.access_token) throw new Error(data.error_description ?? "LinkedIn token exchange failed");
    return { accessToken: data.access_token, expiresIn: data.expires_in, label: "LinkedIn" };
  }

  throw new Error(`Unsupported provider ${provider}`);
}
