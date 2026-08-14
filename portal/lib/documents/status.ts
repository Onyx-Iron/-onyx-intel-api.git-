export interface DocumentProcessingEventLike {
  step: string;
  status: string;
  worker: string | null;
  attempt_number: number;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface DocumentStatusSnapshot {
  document: unknown;
  events: DocumentProcessingEventLike[];
}

export function buildDocumentStatusSnapshot(document: unknown, events: DocumentProcessingEventLike[]): DocumentStatusSnapshot {
  return {
    document,
    events: [...events].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)),
  };
}
