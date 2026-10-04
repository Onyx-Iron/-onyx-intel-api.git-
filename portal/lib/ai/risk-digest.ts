/** Money fields copied into a risk-digest snapshot from the project row. */
export const RISK_DIGEST_MONEY_KEYS = ["budget", "estimate", "budget_variance"] as const;

export interface RiskDigestView {
  bullets?: string[] | null;
  data_snapshot?: Record<string, unknown> | null;
}

function moneyAmounts(snapshot: Record<string, unknown> | null | undefined): number[] {
  if (!snapshot) return [];
  const amounts: number[] = [];
  for (const key of RISK_DIGEST_MONEY_KEYS) {
    const value = snapshot[key];
    if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) >= 100) {
      amounts.push(Math.abs(value));
    }
  }
  return amounts;
}

function mentionsAmount(bullet: string, amount: number): boolean {
  const rounded = Math.round(amount);
  const raw = String(rounded);
  const grouped = rounded.toLocaleString("en-US");
  const rawPattern = new RegExp(`(?<![\\d])${raw}(?![\\d])`);
  if (rawPattern.test(bullet)) return true;
  return grouped !== raw && bullet.includes(grouped);
}

/** True when a stored bullet quotes a dollar figure or a snapshot amount. */
export function bulletMentionsMoney(bullet: string, amounts: readonly number[]): boolean {
  if (/\$\s*\d/.test(bullet)) return true;
  return amounts.some((amount) => mentionsAmount(bullet, amount));
}

/**
 * Project overview shows this digest to every role. Restricted roles keep
 * the risk level, and lose budget, estimate, variance, and any bullet that
 * quotes those figures.
 */
export function redactRiskDigest<T extends RiskDigestView>(digest: T, canReadMoney: boolean): T {
  if (canReadMoney) return digest;
  const snapshot = digest.data_snapshot;
  const amounts = moneyAmounts(snapshot);
  const bullets = (digest.bullets ?? []).filter((bullet) => !bulletMentionsMoney(bullet, amounts));
  if (!snapshot || typeof snapshot !== "object") {
    return { ...digest, bullets };
  }
  const data_snapshot: Record<string, unknown> = { ...snapshot };
  for (const key of RISK_DIGEST_MONEY_KEYS) {
    if (key in data_snapshot) data_snapshot[key] = null;
  }
  return { ...digest, bullets, data_snapshot };
}
