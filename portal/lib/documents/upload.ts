import type { TablesInsert } from "@/lib/supabase/types";
import { buildDocumentRevisionMeta } from "./revisions.ts";

export type DocumentUploadStorageType = "drive" | "supabase";
export const LOCAL_DOCUMENT_BUCKET = "plans-bucket";
export const LOCAL_DOCUMENT_MAX_BYTES = 1024 * 1024 * 1024;
const LEGACY_LOCAL_DOCUMENT_BUCKET = "project-documents";

export interface UploadRequestInfo {
  contentType: string;
  bodyStorageType?: DocumentUploadStorageType;
}

export function detectDocumentUploadStorageType(info: UploadRequestInfo): DocumentUploadStorageType {
  return info.contentType.includes("multipart/form-data") ? "supabase" : (info.bodyStorageType ?? "drive");
}

export function buildLocalDocumentInsert(args: {
  documentId: string;
  tenantId: string;
  projectId: string;
  fileName: string;
  storagePath: string;
  fileSize: number;
  contentType: string;
}): TablesInsert<"documents"> {
  return {
    id: args.documentId,
    tenant_id: args.tenantId,
    project_id: args.projectId,
    file_name: args.fileName,
    status: "pending",
    uploaded_at: new Date().toISOString(),
    meta: buildDocumentRevisionMeta(args.fileName, {
      source: "local_upload",
      storage: "supabase",
      storage_bucket: LOCAL_DOCUMENT_BUCKET,
      storage_path: args.storagePath,
      size: args.fileSize,
      content_type: args.contentType,
    }),
  };
}

export function resolveDocumentStorageBucket(meta: Record<string, unknown>): string {
  if (typeof meta.storage_bucket === "string" && meta.storage_bucket.trim()) {
    return meta.storage_bucket.trim();
  }
  // Backward compatibility: local uploads historically omitted the bucket,
  // while Drive imports copied into Storage used plans-bucket.
  return meta.source === "local_upload" || meta.storage === "supabase"
    ? LEGACY_LOCAL_DOCUMENT_BUCKET
    : "plans-bucket";
}
