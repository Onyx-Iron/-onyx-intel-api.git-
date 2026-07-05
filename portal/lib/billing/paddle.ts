import crypto from "node:crypto";

export interface PaddleConfig {
  apiKey: string;
  env: "sandbox" | "live";
  webhookSecret: string;
}

export function getPaddleConfig(): PaddleConfig | null {
  const apiKey = process.env.PADDLE_API_KEY;
  const webhookSecret = process.env.PADDLE_WEBHOOK_SECRET;
  if (!apiKey || !webhookSecret) return null;
  const env: "sandbox" | "live" =
    process.env.PADDLE_ENV === "live" ? "live" : "sandbox";
  return { apiKey, env, webhookSecret };
}

function baseUrl(env: "sandbox" | "live"): string {
  return env === "live" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
}

async function paddleFetch(
  cfg: PaddleConfig,
  path: string,
  init: RequestInit,
): Promise<unknown> {
  const res = await fetch(`${baseUrl(cfg.env)}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    const errMsg =
      (json &&
        typeof json === "object" &&
        "error" in json &&
        JSON.stringify((json as { error: unknown }).error)) ||
      text ||
      `Paddle ${res.status}`;
    throw new Error(`Paddle API ${res.status} ${path}: ${errMsg}`);
  }
  return json;
}

export async function createTransactionCheckout(opts: {
  priceId: string;
  customerEmail: string;
  tenantId: string;
  userId: string;
  successUrl: string;
}): Promise<{ url: string; transactionId: string }> {
  const cfg = getPaddleConfig();
  if (!cfg) throw new Error("Paddle not configured");

  const body = {
    items: [{ price_id: opts.priceId, quantity: 1 }],
    customer_email: opts.customerEmail,
    custom_data: { tenant_id: opts.tenantId, user_id: opts.userId },
    collection_mode: "automatic",
    checkout: { url: opts.successUrl },
  };

  const raw = await paddleFetch(cfg, "/transactions", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const data =
    raw && typeof raw === "object" && "data" in raw
      ? (raw as { data: Record<string, unknown> }).data
      : null;
  if (!data) throw new Error("Paddle: missing data in /transactions response");

  const checkout = data.checkout as { url?: string } | undefined;
  const url = checkout?.url;
  const transactionId = data.id as string | undefined;
  if (!url || !transactionId) {
    throw new Error("Paddle: missing checkout.url or transaction id");
  }
  return { url, transactionId };
}

export async function createCustomerPortalSession(opts: {
  paddleCustomerId: string;
  subscriptionId?: string;
}): Promise<{ url: string }> {
  const cfg = getPaddleConfig();
  if (!cfg) throw new Error("Paddle not configured");

  const body: Record<string, unknown> = {};
  if (opts.subscriptionId) body.subscription_ids = [opts.subscriptionId];

  const raw = await paddleFetch(
    cfg,
    `/customers/${encodeURIComponent(opts.paddleCustomerId)}/portal-sessions`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

  const data =
    raw && typeof raw === "object" && "data" in raw
      ? (raw as { data: Record<string, unknown> }).data
      : null;
  if (!data) throw new Error("Paddle: missing data in portal-sessions response");
  const urls = data.urls as
    | { general?: { overview?: string } }
    | undefined;
  const url = urls?.general?.overview;
  if (!url) throw new Error("Paddle: missing urls.general.overview");
  return { url };
}

export function verifyWebhookSignature(
  signatureHeader: string | null,
  rawBody: string,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(";").map((p) => p.trim());
  let ts: string | null = null;
  const h1s: string[] = [];
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (!k || !v) continue;
    if (k === "ts") ts = v;
    else if (k === "h1") h1s.push(v);
  }
  if (!ts || h1s.length === 0) return false;

  const signedPayload = `${ts}:${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  for (const h of h1s) {
    let hBuf: Buffer;
    try {
      hBuf = Buffer.from(h, "hex");
    } catch {
      continue;
    }
    if (hBuf.length === expectedBuf.length && crypto.timingSafeEqual(hBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}
