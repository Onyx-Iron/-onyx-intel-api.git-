/** Items waiting on a human approve/reject before they can price. */
export function needsReviewDecision(status: string | null | undefined): boolean {
  return status === "suggested" || status === "reviewed";
}

export async function reviewTakeoffItem(
  takeoffId: string,
  action: "approve" | "reject",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`/api/takeoff/items/${encodeURIComponent(takeoffId)}/review`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: data.error ?? String(res.status) };
  }
  return { ok: true };
}
