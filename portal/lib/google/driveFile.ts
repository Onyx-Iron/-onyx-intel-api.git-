/**
 * Lightweight Drive metadata lookup — avoids downloading a PDF just to learn its size.
 */
export async function fetchDriveFileSize(
  driveFileId: string,
  accessToken: string,
): Promise<number | null> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?fields=size`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { size?: string };
  const parsed = data.size != null ? Number(data.size) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
