import { createServiceClient } from "@/lib/supabase/server";
import { getAccessToken } from "./oauth";

const ROOT_FOLDER_NAME = "Onyx Intel — Plans";
const FOLDER_MIME = "application/vnd.google-apps.folder";

interface DriveListResult {
  files?: Array<{ id: string; createdTime?: string }>;
}

/** Find or create the root "Onyx Intel — Plans" folder in the user's Drive. */
async function ensureRootFolder(token: string): Promise<string> {
  const authHeader = { Authorization: `Bearer ${token}` };
  const q = encodeURIComponent(`name='${ROOT_FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`);
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,createdTime)&orderBy=createdTime&spaces=drive`,
    { headers: authHeader },
  );
  if (!listRes.ok) throw new Error(`[drive root list ${listRes.status}]`);
  const list = await listRes.json() as DriveListResult;
  if (list.files && list.files.length > 0) return list.files[0].id;

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { ...authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ name: ROOT_FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  if (!createRes.ok) throw new Error(`[drive root create ${createRes.status}]`);
  const created = await createRes.json() as { id?: string };
  if (!created.id) throw new Error("Drive did not return a folder id");
  return created.id;
}

/** Find or create a project-specific subfolder under the root folder. */
async function ensureProjectFolderInDrive(token: string, parentId: string, projectName: string): Promise<string> {
  const authHeader = { Authorization: `Bearer ${token}` };
  const safeName = projectName.replace(/['"\\]/g, "").trim() || "Project";
  const q = encodeURIComponent(`name='${safeName}' and mimeType='${FOLDER_MIME}' and '${parentId}' in parents and trashed=false`);
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,createdTime)&orderBy=createdTime&spaces=drive`,
    { headers: authHeader },
  );
  if (!listRes.ok) throw new Error(`[drive project list ${listRes.status}]`);
  const list = await listRes.json() as DriveListResult;
  if (list.files && list.files.length > 0) return list.files[0].id;

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { ...authHeader, "Content-Type": "application/json" },
    body: JSON.stringify({ name: safeName, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  if (!createRes.ok) throw new Error(`[drive project create ${createRes.status}]`);
  const created = await createRes.json() as { id?: string };
  if (!created.id) throw new Error("Drive did not return a project folder id");
  return created.id;
}

/**
 * Get-or-create the project's Drive folder. Caches the folder id on
 * projects.meta.drive_folder_id so subsequent calls skip the Drive round trip.
 *
 * Returns null if Drive isn't connected — caller should treat that as
 * "skip Drive sync this time" rather than failing.
 */
export async function ensureProjectDriveFolder(
  tenantId: string,
  userId: string,
  projectId: string,
): Promise<{ folderId: string; token: string } | null> {
  const token = await getAccessToken(tenantId, userId);
  if (!token) return null;

  const db = await createServiceClient();
  const { data: project } = await db
    .from("projects")
    .select("id, name, meta")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .single();
  if (!project) return null;

  const meta = (project.meta ?? {}) as Record<string, unknown>;
  const cachedId = typeof meta.drive_folder_id === "string" && meta.drive_folder_id ? meta.drive_folder_id : null;

  if (cachedId) {
    // Verify the cached folder still exists, isn't trashed, and hasn't been
    // moved out from under the root "Onyx Intel — Plans" parent. The user can
    // move a folder in the Drive UI; if they do, our cached id points at a
    // folder that's no longer in the canonical location.
    const verifyRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${cachedId}?fields=id,name,trashed,parents`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (verifyRes.ok) {
      const data = await verifyRes.json() as { name?: string; trashed?: boolean; parents?: string[] };
      // If the folder has been moved out of any parent (orphaned) or moved to
      // somewhere else entirely, drop the cache and re-create under the root.
      // We do NOT force-move user-organized folders — we just keep using
      // whatever folder still exists, only re-creating when the cached id is
      // unusable (trashed, orphaned, or fetch failed).
      const orphaned = !data.parents || data.parents.length === 0;
      if (!data.trashed && !orphaned) {
        // Project may have been renamed since the folder was created — keep the
        // folder name in sync so existing reports + new ones stay together.
        const desiredName = (project.name ?? "").replace(/['"\\]/g, "").trim() || "Project";
        if (data.name && data.name !== desiredName) {
          await fetch(`https://www.googleapis.com/drive/v3/files/${cachedId}`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name: desiredName }),
          }).catch(() => undefined);
        }
        return { folderId: cachedId, token };
      }
    }
    // Cached folder gone — fall through to re-create
  }

  const rootId = await ensureRootFolder(token);
  const folderId = await ensureProjectFolderInDrive(token, rootId, project.name);

  // Cache on the project row
  await db
    .from("projects")
    .update({ meta: { ...meta, drive_folder_id: folderId } } as never)
    .eq("id", projectId)
    .eq("tenant_id", tenantId);

  return { folderId, token };
}

/**
 * Create a Google Doc from text content directly inside the project's Drive
 * folder. Returns the Doc id and shareable URL, or null on any failure
 * (this is a best-effort autosave — don't block the calling flow).
 */
export async function createGoogleDocInProjectFolder(
  tenantId: string,
  userId: string,
  projectId: string,
  title: string,
  content: string,
): Promise<{ documentId: string; url: string; folderId: string } | null> {
  try {
    const folder = await ensureProjectDriveFolder(tenantId, userId, projectId);
    if (!folder) return null;
    const { folderId, token } = folder;

    // 1. Create empty Doc (Docs API puts it in My Drive root by default)
    const createRes = await fetch("https://docs.googleapis.com/v1/documents", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!createRes.ok) return null;
    const doc = await createRes.json() as { documentId?: string };
    if (!doc.documentId) return null;

    // 2. Insert the content
    await fetch(`https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ insertText: { location: { index: 1 }, text: content } }] }),
    }).catch(() => undefined);

    // 3. Move into the project folder via Drive API (need to first find the current parent)
    const fileRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${doc.documentId}?fields=parents`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    let removeParents = "root";
    if (fileRes.ok) {
      const fd = await fileRes.json() as { parents?: string[] };
      if (fd.parents && fd.parents.length > 0) removeParents = fd.parents.join(",");
    }
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${doc.documentId}?addParents=${folderId}&removeParents=${removeParents}&fields=id,parents`,
      { method: "PATCH", headers: { Authorization: `Bearer ${token}` } },
    ).catch(() => undefined);

    return {
      documentId: doc.documentId,
      url: `https://docs.google.com/document/d/${doc.documentId}/edit`,
      folderId,
    };
  } catch {
    return null;
  }
}
