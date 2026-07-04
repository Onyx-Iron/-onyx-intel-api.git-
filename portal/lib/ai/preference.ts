/**
 * User AI preference — provider + model — persisted server-side via HttpOnly
 * cookies. Read at request time so every AI route respects the choice without
 * threading extra props through UI code.
 */

import { cookies } from "next/headers";
import type { Provider } from "./providers";

export const PROVIDER_COOKIE = "onyx_ai_provider";
export const MODEL_COOKIE    = "onyx_ai_model";

// Whitelisted models per provider. Used both by the picker UI and to validate
// server-side. Keys stay short so they fit in cookies (<4 KB per RFC 6265).
export const MODEL_OPTIONS: Record<Provider, ReadonlyArray<{ id: string; label: string; hint?: string }>> = {
  gemini: [
    { id: "gemini-2.5-pro",   label: "Gemini 2.5 Pro",   hint: "Highest quality · slower" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "Fast · lower cost" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "Cheapest" },
  ],
  openai: [
    { id: "gpt-4o",           label: "GPT-4o",           hint: "Balanced" },
    { id: "gpt-4o-mini",      label: "GPT-4o mini",      hint: "Cheap · quick" },
    { id: "gpt-4.1",          label: "GPT-4.1",          hint: "Long context" },
    { id: "o4-mini",          label: "o4-mini (reasoning)", hint: "Slow · high accuracy" },
  ],
  anthropic: [
    { id: "claude-opus-4-8",    label: "Claude Opus 4.8",   hint: "Highest quality" },
    { id: "claude-opus-4-7",    label: "Claude Opus 4.7",   hint: "Second tier" },
    { id: "claude-sonnet-4-6",  label: "Claude Sonnet 4.6", hint: "Balanced" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "Fast · cheap" },
  ],
};

const VALID_PROVIDERS: readonly Provider[] = ["gemini", "openai", "anthropic"];

export function isValidProvider(p: string): p is Provider {
  return (VALID_PROVIDERS as readonly string[]).includes(p);
}

export function isValidModel(provider: Provider, model: string): boolean {
  return MODEL_OPTIONS[provider].some((m) => m.id === model);
}

/**
 * Read the user's preferred provider + model from cookies. Both values are
 * validated against the whitelist; anything unrecognized returns undefined so
 * `resolveProvider()` falls back to the env default.
 */
export async function getUserAIPreference(): Promise<{ provider?: Provider; model?: string }> {
  try {
    const jar = await cookies();
    const providerRaw = jar.get(PROVIDER_COOKIE)?.value;
    const modelRaw    = jar.get(MODEL_COOKIE)?.value;

    const provider = providerRaw && isValidProvider(providerRaw) ? providerRaw : undefined;
    const model    = provider && modelRaw && isValidModel(provider, modelRaw) ? modelRaw : undefined;
    return { provider, model };
  } catch {
    return {};
  }
}
