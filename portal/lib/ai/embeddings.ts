import { headerSafe } from "@/lib/http";

const GEMINI_API_KEY = headerSafe(process.env.GEMINI_API_KEY);
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL ?? "text-embedding-004";

/** Embed a user query for vector similarity search (RETRIEVAL_QUERY). */
export async function embedQueryText(text: string): Promise<number[]> {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_QUERY",
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Embed failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  const data = (await res.json()) as { embedding?: { values?: number[] } };
  const values = data.embedding?.values;
  if (!values?.length) throw new Error("Embed returned empty values");
  return values;
}
