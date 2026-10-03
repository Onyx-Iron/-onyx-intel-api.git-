/**
 * Document reading and search embeddings.
 *
 * OpenAI is preferred: it is the provider configured in production, and
 * gpt-4.1 reads PDF page images at high detail. Gemini remains the fallback
 * when only that key is present. Embeddings stay 768-dimensional so they fit
 * the existing pgvector columns. There is one embedding model per process,
 * so index and query stay in the same vector space.
 */

export const EMBEDDING_DIMENSIONS = 768;
export const OPENAI_DOCUMENT_MODEL = "gpt-4.1";
export const OPENAI_EMBED_MODEL = "text-embedding-3-large";

export type DocumentProvider = "openai" | "gemini";

export function configuredDocumentProvider(env: NodeJS.ProcessEnv | {
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
} = process.env): DocumentProvider | null {
  if (env.OPENAI_API_KEY?.trim()) return "openai";
  if (env.GEMINI_API_KEY?.trim()) return "gemini";
  return null;
}

export function openaiDocumentRequest(input: {
  fileName: string;
  mimeType: string;
  dataUrl: string;
  prompt: string;
  json?: boolean;
  model?: string;
}): Record<string, unknown> {
  const isPdf = input.mimeType === "application/pdf" || input.fileName.toLowerCase().endsWith(".pdf");
  const filePart = isPdf
    ? {
        type: "input_file",
        filename: input.fileName.endsWith(".pdf") ? input.fileName : `${input.fileName}.pdf`,
        file_data: input.dataUrl,
        detail: "high",
      }
    : {
        type: "input_image",
        image_url: input.dataUrl,
        detail: "high",
      };
  return {
    model: input.model ?? OPENAI_DOCUMENT_MODEL,
    input: [{
      role: "user",
      content: [filePart, { type: "input_text", text: input.prompt }],
    }],
    ...(input.json ? { text: { format: { type: "json_object" } } } : {}),
  };
}

export function openaiResponseText(data: {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}): string {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;
  const parts = (data.output ?? []).flatMap((item) => item.content ?? []);
  return parts.map((part) => part.text ?? "").join("");
}

export function openaiEmbeddingRequest(text: string | string[]): Record<string, unknown> {
  return {
    model: OPENAI_EMBED_MODEL,
    input: text,
    dimensions: EMBEDDING_DIMENSIONS,
  };
}

/** Chat model for answers over retrieved sheets. Operators can override with OPENAI_MODEL. */
export function resolveOpenAIChatModel(env: NodeJS.ProcessEnv | { OPENAI_MODEL?: string } = process.env): string {
  return env.OPENAI_MODEL?.trim() || OPENAI_DOCUMENT_MODEL;
}

export function chatCompletionDelta(data: {
  choices?: Array<{ delta?: { content?: string | null } }>;
}): string {
  const content = data.choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : "";
}

interface JsonSchemaNode {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchemaNode | undefined>;
  required?: string[];
}

/** Gemini tool schemas use OBJECT/STRING. OpenAI function tools need JSON Schema. */
export function toJsonSchema(node: JsonSchemaNode): Record<string, unknown> {
  const type = (node.type ?? "string").toLowerCase();
  const out: Record<string, unknown> = { type };
  if (node.description) out.description = node.description;
  if (node.properties) {
    out.properties = Object.fromEntries(
      Object.entries(node.properties)
        .filter((entry): entry is [string, JsonSchemaNode] => entry[1] != null)
        .map(([key, value]) => [key, toJsonSchema(value)]),
    );
  }
  if (node.required) out.required = node.required;
  return out;
}

export function openaiToolDefinitions(declarations: Array<{
  name: string;
  description: string;
  parameters: JsonSchemaNode;
}>): Array<Record<string, unknown>> {
  return declarations.map((declaration) => ({
    type: "function",
    function: {
      name: declaration.name,
      description: declaration.description,
      parameters: toJsonSchema(declaration.parameters),
    },
  }));
}

export function openaiEmbeddingVectors(data: {
  data?: Array<{ embedding?: number[]; index?: number }>;
}, expected: number): number[][] {
  const rows = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (rows.length !== expected) {
    throw new Error(`Embedding model ${OPENAI_EMBED_MODEL} returned ${rows.length} vectors; expected ${expected}`);
  }
  return rows.map((row, i) => {
    const values = row.embedding ?? [];
    if (values.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Embedding model ${OPENAI_EMBED_MODEL} returned ${values.length} dimensions for input ${i}; expected ${EMBEDDING_DIMENSIONS}`);
    }
    return values;
  });
}

function dataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function openaiKey(explicit?: string): string {
  const key = explicit?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  return key;
}

export async function readWithOpenAI(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  prompt: string;
  json?: boolean;
  apiKey?: string;
}): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey(input.apiKey)}`,
    },
    body: JSON.stringify(openaiDocumentRequest({
      fileName: input.fileName,
      mimeType: input.mimeType,
      dataUrl: dataUrl(input.bytes, input.mimeType),
      prompt: input.prompt,
      json: input.json,
    })),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => res.statusText)).slice(0, 300);
    throw new Error(`OpenAI document read failed (${res.status}): ${detail}`);
  }
  const text = openaiResponseText(await res.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> });
  if (!text.trim()) throw new Error("OpenAI document read returned an empty response");
  return text;
}

export async function embedWithOpenAI(text: string, apiKey?: string): Promise<number[]> {
  const [vector] = await embedManyWithOpenAI([text], apiKey);
  return vector;
}

export async function embedManyWithOpenAI(texts: string[], apiKey?: string): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openaiKey(apiKey)}`,
    },
    body: JSON.stringify(openaiEmbeddingRequest(texts)),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => res.statusText)).slice(0, 300);
    throw new Error(`OpenAI embedding failed (${res.status}): ${detail}`);
  }
  return openaiEmbeddingVectors(await res.json() as { data?: Array<{ embedding?: number[]; index?: number }> }, texts.length);
}
