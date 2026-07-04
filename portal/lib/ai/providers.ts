/**
 * Multi-model AI layer for Onyx Intel.
 * ------------------------------------
 * One unified `generateText()` over three providers:
 *   - gemini    (live now — billing key, gemini-2.5-pro)
 *   - openai    (activates when OPENAI_API_KEY is set)
 *   - anthropic (activates when ANTHROPIC_API_KEY is set)
 *
 * Selection order when no provider is forced: env AI_DEFAULT_PROVIDER, else the
 * first one that has a key, in preference order [gemini, openai, anthropic].
 * Callers can force a provider per request (e.g. "use Claude for this").
 */

import { headerSafe } from "@/lib/http";

export type Provider = "gemini" | "openai" | "anthropic";

interface ProviderConfig {
  key: string;
  model: string;
}

const CONFIG: Record<Provider, ProviderConfig> = {
  gemini: {
    key:   headerSafe(process.env.GEMINI_API_KEY),
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-pro",
  },
  openai: {
    key:   headerSafe(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL ?? "gpt-4o",
  },
  anthropic: {
    key:   headerSafe(process.env.ANTHROPIC_API_KEY),
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  },
};

const PREFERENCE: Provider[] = ["gemini", "openai", "anthropic"];

export function availableProviders(): Provider[] {
  return PREFERENCE.filter((p) => CONFIG[p].key);
}

export function resolveProvider(forced?: Provider): Provider | null {
  if (forced && CONFIG[forced].key) return forced;
  const envDefault = process.env.AI_DEFAULT_PROVIDER as Provider | undefined;
  if (envDefault && CONFIG[envDefault]?.key) return envDefault;
  return availableProviders()[0] ?? null;
}

export interface GenerateOptions {
  system?: string;
  prompt: string;
  provider?: Provider;
  model?: string;        // per-call model override (validated against the picker's list elsewhere)
  json?: boolean;        // ask the model to return strict JSON
  maxTokens?: number;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  provider: Provider;
  model: string;
}

export class NoProviderError extends Error {
  constructor() {
    super("No AI provider configured. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.");
    this.name = "NoProviderError";
  }
}

export async function generateText(opts: GenerateOptions): Promise<GenerateResult> {
  // Precedence for provider + model:
  //   1. Explicit `opts.provider` / `opts.model` from the caller.
  //   2. User's per-session preference from cookies (if signed in).
  //   3. `AI_DEFAULT_PROVIDER` env var.
  //   4. First provider with an API key configured.
  // We lazy-import the cookie reader so this module stays usable in edge / test
  // contexts that don't have `next/headers` available.
  let provider = opts.provider ? resolveProvider(opts.provider) : null;
  let model = opts.model;

  if (!provider) {
    try {
      const { getUserAIPreference } = await import("./preference");
      const pref = await getUserAIPreference();
      if (pref.provider) {
        const p = resolveProvider(pref.provider);
        if (p) { provider = p; if (!model && pref.model) model = pref.model; }
      }
    } catch {
      // next/headers not available (e.g. edge runtime, tests) — fall through.
    }
  }

  if (!provider) provider = resolveProvider();
  if (!provider) throw new NoProviderError();

  const finalModel = model ?? CONFIG[provider].model;
  const maxTokens = opts.maxTokens ?? 4096;
  const temperature = opts.temperature ?? 0.3;

  let text: string;
  if (provider === "gemini")        text = await callGemini(opts, finalModel, maxTokens, temperature);
  else if (provider === "openai")   text = await callOpenAI(opts, finalModel, maxTokens, temperature);
  else                              text = await callAnthropic(opts, finalModel, maxTokens, temperature);

  return { text, provider, model: finalModel };
}

// ── Gemini ───────────────────────────────────────────────────────────────────
async function callGemini(o: GenerateOptions, model: string, maxTokens: number, temperature: number): Promise<string> {
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: o.prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(o.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (o.system) body.system_instruction = { parts: [{ text: o.system }] };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": CONFIG.gemini.key },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`[gemini ${res.status}] ${(await res.text()).slice(0, 400)}`);
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

// ── OpenAI ───────────────────────────────────────────────────────────────────
async function callOpenAI(o: GenerateOptions, model: string, maxTokens: number, temperature: number): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (o.system) messages.push({ role: "system", content: o.system });
  messages.push({ role: "user", content: o.prompt });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${CONFIG.openai.key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
      ...(o.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`[openai ${res.status}] ${(await res.text()).slice(0, 400)}`);
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

// ── Anthropic ────────────────────────────────────────────────────────────────
async function callAnthropic(o: GenerateOptions, model: string, maxTokens: number, temperature: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": CONFIG.anthropic.key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      ...(o.system ? { system: o.system } : {}),
      messages: [{ role: "user", content: o.prompt }],
    }),
  });
  if (!res.ok) throw new Error(`[anthropic ${res.status}] ${(await res.text()).slice(0, 400)}`);
  const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
  return (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}
