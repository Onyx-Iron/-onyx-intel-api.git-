-- v9: Document intelligence tables
-- pgvector for semantic search, per-page summaries, chunks, memories, conversations

-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Add doc_type and drive_file_id columns to existing documents table
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS doc_type text
    CHECK (doc_type IN ('drawing', 'spec', 'rfi', 'submittal', 'other'));

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS drive_file_id text;

-- Pages: one row per page, stores Gemini-extracted summary + key terms
CREATE TABLE IF NOT EXISTS pages (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    text        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id      uuid        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  page_number    integer     NOT NULL,
  extracted_text text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, page_number)
);
CREATE INDEX IF NOT EXISTS idx_pages_document ON pages(document_id);
CREATE INDEX IF NOT EXISTS idx_pages_tenant   ON pages(tenant_id);

-- Chunks: text chunks + 768-dim Google text-embedding-004 vectors
CREATE TABLE IF NOT EXISTS chunks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id text        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tenant_id   uuid        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  project_id  uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_number integer,
  content     text        NOT NULL,
  embedding   vector(768),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_tenant   ON chunks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_chunks_project  ON chunks(project_id);
CREATE INDEX IF NOT EXISTS chunks_hnsw
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Memories: AI-extracted key facts from documents for quick retrieval
CREATE TABLE IF NOT EXISTS memories (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id          uuid        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  fact               text        NOT NULL,
  source_document_id text        REFERENCES documents(id) ON DELETE SET NULL,
  source_page        integer,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_tenant  ON memories(tenant_id);

-- Conversations: project-scoped Q&A sessions
CREATE TABLE IF NOT EXISTS conversations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tenant_id  uuid        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);

-- Messages: individual turns in a conversation
CREATE TABLE IF NOT EXISTS messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  tenant_id       uuid        NOT NULL REFERENCES tenants(id)       ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content         text        NOT NULL,
  citations       jsonb       NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

-- RLS for all new tables
ALTER TABLE pages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_pages ON pages
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE clerk_org_id = current_setting('app.clerk_org_id', true))
  );

CREATE POLICY tenant_isolation_chunks ON chunks
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE clerk_org_id = current_setting('app.clerk_org_id', true))
  );

CREATE POLICY tenant_isolation_memories ON memories
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE clerk_org_id = current_setting('app.clerk_org_id', true))
  );

CREATE POLICY tenant_isolation_conversations ON conversations
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE clerk_org_id = current_setting('app.clerk_org_id', true))
  );

CREATE POLICY tenant_isolation_messages ON messages
  FOR ALL USING (
    tenant_id IN (SELECT id FROM tenants WHERE clerk_org_id = current_setting('app.clerk_org_id', true))
  );
