/**
 * Cloud storage provider contract for the Company Hub.
 * All imports end in the same documents insert + ingest path —
 * providers only list/download; they do not process plans.
 */

export type StorageProviderId =
  | "google_drive"
  | "dropbox"
  | "sharefile"
  | "local_upload"
  | "gmail";

export interface CloudFileMeta {
  id: string;
  name: string;
  mimeType: string | null;
  size: number | null;
  path?: string;
  modifiedAt?: string | null;
}

export interface CloudStorageProvider {
  id: StorageProviderId;
  label: string;
  /** Whether this provider supports OAuth connect in Connections settings. */
  supportsOAuth: boolean;
  listFolder?(accessToken: string, path: string): Promise<CloudFileMeta[]>;
  getFileMetadata?(accessToken: string, fileId: string): Promise<CloudFileMeta | null>;
  downloadToBuffer?(accessToken: string, fileId: string): Promise<{ bytes: Uint8Array; mimeType: string; name: string }>;
}

export const GOOGLE_DRIVE_PROVIDER: CloudStorageProvider = {
  id: "google_drive",
  label: "Google Drive",
  supportsOAuth: true,
  async getFileMetadata(accessToken, fileId) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,modifiedTime`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!res.ok) return null;
    const data = await res.json() as { id: string; name: string; mimeType?: string; size?: string; modifiedTime?: string };
    return {
      id: data.id,
      name: data.name,
      mimeType: data.mimeType ?? null,
      size: data.size != null ? Number(data.size) : null,
      modifiedAt: data.modifiedTime ?? null,
    };
  },
  async downloadToBuffer(accessToken, fileId) {
    const meta = await GOOGLE_DRIVE_PROVIDER.getFileMetadata!(accessToken, fileId);
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    return {
      bytes: buf,
      mimeType: meta?.mimeType ?? "application/octet-stream",
      name: meta?.name ?? fileId,
    };
  },
  async listFolder(accessToken, folderId) {
    const q = folderId && folderId !== "root"
      ? `'${folderId.replace(/'/g, "\\'")}' in parents and trashed=false`
      : `'root' in parents and trashed=false`;
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", q);
    url.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime)");
    url.searchParams.set("pageSize", "50");
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
    const data = await res.json() as { files?: Array<{ id: string; name: string; mimeType?: string; size?: string; modifiedTime?: string }> };
    return (data.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType ?? null,
      size: f.size != null ? Number(f.size) : null,
      modifiedAt: f.modifiedTime ?? null,
    }));
  },
};

export const DROPBOX_PROVIDER: CloudStorageProvider = {
  id: "dropbox",
  label: "Dropbox",
  supportsOAuth: true,
  async listFolder(accessToken, path) {
    const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: path || "", limit: 50 }),
    });
    if (!res.ok) throw new Error(`Dropbox list failed: ${res.status}`);
    const data = await res.json() as {
      entries?: Array<{ ".tag": string; id: string; name: string; size?: number; client_modified?: string; path_display?: string }>;
    };
    return (data.entries ?? [])
      .filter((e) => e[".tag"] === "file")
      .map((e) => ({
        id: e.id,
        name: e.name,
        mimeType: null,
        size: e.size ?? null,
        path: e.path_display,
        modifiedAt: e.client_modified ?? null,
      }));
  },
  async downloadToBuffer(accessToken, pathOrId) {
    const res = await fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Dropbox-API-Arg": JSON.stringify({ path: pathOrId }),
      },
    });
    if (!res.ok) throw new Error(`Dropbox download failed: ${res.status}`);
    const apiResult = res.headers.get("dropbox-api-result");
    let name = pathOrId;
    if (apiResult) {
      try {
        const meta = JSON.parse(apiResult) as { name?: string };
        if (meta.name) name = meta.name;
      } catch { /* ignore */ }
    }
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      mimeType: "application/octet-stream",
      name,
    };
  },
};

export const SHAREFILE_PROVIDER: CloudStorageProvider = {
  id: "sharefile",
  label: "ShareFile",
  supportsOAuth: true,
  async listFolder(accessToken, itemId) {
    const base = process.env.SHAREFILE_API_BASE ?? "https://secure.sf-api.com/sf/v3";
    const id = itemId || "home";
    const res = await fetch(`${base}/Items(${encodeURIComponent(id)})/Children?$select=Id,Name,FileSizeBytes,CreationDate`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`ShareFile list failed: ${res.status}`);
    const data = await res.json() as {
      value?: Array<{ Id: string; Name: string; FileSizeBytes?: number; CreationDate?: string }>;
    };
    return (data.value ?? []).map((e) => ({
      id: e.Id,
      name: e.Name,
      mimeType: null,
      size: e.FileSizeBytes ?? null,
      modifiedAt: e.CreationDate ?? null,
    }));
  },
  async downloadToBuffer(accessToken, itemId) {
    const base = process.env.SHAREFILE_API_BASE ?? "https://secure.sf-api.com/sf/v3";
    const metaRes = await fetch(`${base}/Items(${encodeURIComponent(itemId)})?$select=Id,Name`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!metaRes.ok) throw new Error(`ShareFile meta failed: ${metaRes.status}`);
    const meta = await metaRes.json() as { Name?: string };
    const dlRes = await fetch(`${base}/Items(${encodeURIComponent(itemId)})/Download`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "follow",
      cache: "no-store",
    });
    if (!dlRes.ok) throw new Error(`ShareFile download failed: ${dlRes.status}`);
    return {
      bytes: new Uint8Array(await dlRes.arrayBuffer()),
      mimeType: dlRes.headers.get("content-type") ?? "application/octet-stream",
      name: meta.Name ?? itemId,
    };
  },
};

export const LOCAL_UPLOAD_PROVIDER: CloudStorageProvider = {
  id: "local_upload",
  label: "Upload / iCloud Files",
  supportsOAuth: false,
};

export const GMAIL_PROVIDER: CloudStorageProvider = {
  id: "gmail",
  label: "Gmail attachments",
  supportsOAuth: false,
};

const REGISTRY: Record<StorageProviderId, CloudStorageProvider> = {
  google_drive: GOOGLE_DRIVE_PROVIDER,
  dropbox: DROPBOX_PROVIDER,
  sharefile: SHAREFILE_PROVIDER,
  local_upload: LOCAL_UPLOAD_PROVIDER,
  gmail: GMAIL_PROVIDER,
};

export function getStorageProvider(id: StorageProviderId): CloudStorageProvider {
  const p = REGISTRY[id];
  if (!p) throw new Error(`Unknown storage provider: ${id}`);
  return p;
}

export function listStorageProviders(): CloudStorageProvider[] {
  return Object.values(REGISTRY);
}

export function isStorageProviderId(v: string): v is StorageProviderId {
  return v in REGISTRY;
}
