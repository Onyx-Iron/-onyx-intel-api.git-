import { NextRequest, NextResponse } from "next/server";
import { requireGoogleToken } from "@/lib/google/api";

export const runtime = "nodejs";

const FOLDER_NAME = "Onyx Intel — Plans";
const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * Ensures a dedicated "Onyx Intel — Plans" folder exists in the user's Drive and
 * returns its id (creates it if missing). With drive.file scope the app only ever
 * sees folders/files it created, so plan files stay isolated from everything else.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const t = await requireGoogleToken(req);
  if (!t.ok) return NextResponse.json({ error: t.error, code: t.code }, { status: t.status });

  const authHeader = { Authorization: `Bearer ${t.token}` };

  // List all app-created folders with this name, oldest first. Using createdTime ordering
  // lets concurrent first-time uploads converge on the same (earliest) folder.
  async function listFolders(): Promise<Array<{ id: string }>> {
    const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,createdTime)&orderBy=createdTime&spaces=drive`,
      { headers: authHeader },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`[drive folder list ${res.status}] ${detail.slice(0, 200)}`);
    }
    const data = await res.json() as { files?: Array<{ id: string }> };
    return data.files ?? [];
  }

  try {
    const existing = await listFolders();
    if (existing.length > 0) {
      return NextResponse.json({ folder_id: existing[0].id, created: false });
    }

    // Create it
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text().catch(() => createRes.statusText);
      return NextResponse.json({ error: `[drive folder ${createRes.status}] ${detail.slice(0, 300)}` }, { status: 502 });
    }
    const folder = await createRes.json() as { id?: string };

    // Reconcile against any folder a concurrent request created at the same time:
    // keep the earliest, trash the rest (best-effort) so plans never split across folders.
    const all = await listFolders();
    const keep = all[0]?.id ?? folder.id;
    await Promise.all(
      all.filter((f) => f.id !== keep).map((f) =>
        fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
          method: "PATCH",
          headers: { ...authHeader, "Content-Type": "application/json" },
          body: JSON.stringify({ trashed: true }),
        }).catch(() => undefined),
      ),
    );
    return NextResponse.json({ folder_id: keep, created: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, code: "NEED_GOOGLE" }, { status: 502 });
  }
}
