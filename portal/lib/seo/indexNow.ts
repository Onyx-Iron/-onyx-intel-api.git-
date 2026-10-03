/** IndexNow — free instant URL notification for Bing/Yandex/etc. */

export async function pingIndexNow(opts: {
  host: string;
  key: string;
  keyLocation?: string;
  urlList: string[];
}): Promise<{ ok: boolean; status: number; detail?: string }> {
  const urls = opts.urlList.filter(Boolean);
  if (urls.length === 0) return { ok: false, status: 400, detail: "urlList empty" };

  const body = {
    host: opts.host.replace(/^https?:\/\//, "").replace(/\/$/, ""),
    key: opts.key,
    keyLocation: opts.keyLocation,
    urlList: urls,
  };

  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    return { ok: false, status: res.status, detail: detail.slice(0, 300) };
  }
  return { ok: true, status: res.status };
}
