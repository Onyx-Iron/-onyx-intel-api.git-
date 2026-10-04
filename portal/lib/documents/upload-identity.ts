/** Same file uploaded again in one project reuses the existing document row. */

export type UploadReuse = "new" | "skip_upload" | "replace_bytes";

const IN_FLIGHT = new Set(["pending", "processing", "queued", "split"]);
const DONE = new Set(["complete", "ready", "done"]);

export function reuseUpload(existingStatus: string | null | undefined): UploadReuse {
  if (!existingStatus) return "new";
  if (DONE.has(existingStatus) || IN_FLIGHT.has(existingStatus)) return "skip_upload";
  return "replace_bytes";
}

export function isSha256Hex(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}
