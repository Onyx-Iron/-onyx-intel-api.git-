import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { generateText, NoProviderError, availableProviders } from "@/lib/ai/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM =
  "You extract contact records from construction documents (spec cover sheets, emails, " +
  "directories, transmittals). Return ONLY valid JSON of the form " +
  '{"contacts":[{"name":"","company":"","role":"","email":"","phone":""}]}. ' +
  "Use empty strings for missing fields. Do not invent contacts — only extract what is present. " +
  "Normalize phone numbers to (XXX) XXX-XXXX when possible.";

interface ParsedContact {
  name: string; company: string; role: string; email: string; phone: string;
}

/**
 * AI contact parsing — extracts structured contacts from pasted document text.
 * Returns candidates for the user to review; does NOT auto-save (the UI confirms).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { text } = await req.json() as { text?: string };
    if (!text?.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });
    if (text.length > 40000) return NextResponse.json({ error: "Text too long (40k char max)" }, { status: 413 });

    let result;
    try {
      result = await generateText({
        system: SYSTEM,
        prompt: `Extract all contacts from the following text:\n\n${text}`,
        json: true,
        maxTokens: 4096,
        temperature: 0,
      });
    } catch (e) {
      if (e instanceof NoProviderError) {
        return NextResponse.json({ error: e.message, code: "NO_PROVIDER", available: availableProviders() }, { status: 503 });
      }
      throw e;
    }

    let contacts: ParsedContact[] = [];
    try {
      const parsed = JSON.parse(result.text) as { contacts?: ParsedContact[] };
      contacts = (parsed.contacts ?? [])
        .filter((c) => c && (c.name || c.company || c.email))
        .map((c) => ({
          name: String(c.name ?? "").slice(0, 200),
          company: String(c.company ?? "").slice(0, 200),
          role: String(c.role ?? "").slice(0, 120),
          email: String(c.email ?? "").slice(0, 200),
          phone: String(c.phone ?? "").slice(0, 60),
        }));
    } catch {
      return NextResponse.json({ error: "Could not parse AI response", raw: result.text.slice(0, 500) }, { status: 502 });
    }

    return NextResponse.json({ contacts, provider: result.provider });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `[POST /api/contacts/parse] ${msg}` }, { status: 502 });
  }
}
