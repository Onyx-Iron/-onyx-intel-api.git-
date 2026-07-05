// ─── Robust JSON repair for AI responses ────────────────────────
export function repairJSON(raw) {
  if (!raw) throw new Error("Empty AI response");

  // 1. Strip markdown fences
  let s = raw.replace(/```(?:json)?\s*\n?/gi, "").replace(/```\s*$/g, "").trim();

  // 2. Find the opening brace/bracket
  const start = s.search(/[{[]/);
  if (start === -1) throw new Error("No JSON structure found in AI response");
  s = s.slice(start);

  // 3. Try direct parse
  try { return JSON.parse(s); } catch { /* continue to repairs */ }

  // 4. Remove trailing commas before } or ]
  const noTrailing = s.replace(/,(\s*[}\]])/g, "$1");
  try { return JSON.parse(noTrailing); } catch { /* continue */ }

  // 5. Close any unclosed structures (walk string aware)
  function closeAndParse(src) {
    const stack = [];
    let inStr = false, escape = false, last = src.length;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\" && inStr) { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
      else if ((ch === "}" || ch === "]") && stack.length) stack.pop();
    }
    if (inStr) {
      // Truncate to last known-good position (before the unclosed string)
      const lastClose = src.lastIndexOf('"}');
      last = lastClose > 0 ? lastClose + 2 : last;
      src = src.slice(0, last);
    }
    // Remove trailing incomplete element
    src = src.replace(/,\s*$/, "").replace(/,(\s*[}\]])/g, "$1");
    const closing = stack.reverse().join("");
    try { return JSON.parse(src + closing); } catch { return null; }
  }

  const closed = closeAndParse(noTrailing);
  if (closed) return closed;

  // 6. Last resort: find the last complete object in an items array
  const lastObjEnd = noTrailing.lastIndexOf("}");
  if (lastObjEnd > 0) {
    const truncated = noTrailing.slice(0, lastObjEnd + 1);
    const fixed = truncated.replace(/,(\s*[}\]])/g, "$1");
    const reClosed = closeAndParse(fixed);
    if (reClosed) return reClosed;
  }

  throw new Error("Could not parse AI response as JSON. The model returned malformed output.");
}

export const PROVIDERS = {
  anthropic: {
    label: "Claude (Anthropic)",
    defaultModel: "claude-sonnet-4-6",
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
    placeholder: "sk-ant-...",
    keysUrl: "https://console.anthropic.com/settings/keys",
    supportsVision: true,
    description: "Most capable reasoning and construction analysis",
  },
  openai: {
    label: "ChatGPT (OpenAI)",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "o1-mini"],
    placeholder: "sk-...",
    keysUrl: "https://platform.openai.com/api-keys",
    supportsVision: true,
    description: "Great for estimates, documents, and general tasks",
  },
  google: {
    label: "Gemini (Google)",
    defaultModel: "gemini-1.5-pro",
    models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    placeholder: "AIza...",
    keysUrl: "https://aistudio.google.com/app/apikey",
    supportsVision: true,
    description: "Fast and cost-effective, integrates with Google Workspace",
  },
  perplexity: {
    label: "Perplexity",
    defaultModel: "sonar-pro",
    models: ["sonar-pro", "sonar", "sonar-reasoning-pro", "sonar-deep-research"],
    placeholder: "pplx-...",
    keysUrl: "https://www.perplexity.ai/settings/api",
    supportsVision: false,
    description: "Live web search — great for current pricing, codes, materials",
  },
  xai: {
    label: "Grok (xAI)",
    defaultModel: "grok-2-latest",
    models: ["grok-2-latest", "grok-2-vision-1212", "grok-3-mini-beta"],
    placeholder: "xai-...",
    keysUrl: "https://console.x.ai/",
    supportsVision: true,
    description: "Real-time data access and fast reasoning",
  },
};

export function providerList() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, ...p }));
}

// ─── OpenAI-compatible helper (used by openai, perplexity, xai) ────
async function openaiCompatChat({ apiKey, model, baseURL }, messages, opts = {}) {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey, baseURL });
  const res = await client.chat.completions.create({
    model,
    max_tokens: opts.maxTokens || 2048,
    response_format: opts.json ? { type: "json_object" } : undefined,
    messages,
  });
  return res.choices[0].message.content;
}

function providerBase(provider) {
  if (provider === "perplexity") return "https://api.perplexity.ai";
  if (provider === "xai") return "https://api.x.ai/v1";
  return undefined;
}

// ─── Vision (image → text) ────────────────────────────────────────
export async function visionRead({ provider, apiKey, model }, pngBase64, prompt) {
  const m = model || PROVIDERS[provider]?.defaultModel;

  if (provider === "anthropic") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: m,
      max_tokens: 4096,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: pngBase64 } },
        { type: "text", text: prompt },
      ]}],
    });
    return msg.content[0].text;
  }

  if (provider === "openai" || provider === "xai") {
    const baseURL = providerBase(provider);
    return openaiCompatChat({ apiKey, model: m, baseURL }, [{
      role: "user", content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${pngBase64}` } },
        { type: "text", text: prompt },
      ],
    }], { maxTokens: 4096 });
  }

  if (provider === "google") {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const gm = genAI.getGenerativeModel({ model: m });
    const res = await gm.generateContent([{ inlineData: { mimeType: "image/png", data: pngBase64 } }, prompt]);
    return res.response.text();
  }

  if (provider === "perplexity") {
    // Perplexity doesn't support vision — fall back to text-only with description
    return openaiCompatChat(
      { apiKey, model: m, baseURL: providerBase(provider) },
      [{ role: "user", content: `[Plan image analysis requested]\n${prompt}` }]
    );
  }

  throw new Error("Unknown provider: " + provider);
}

// ─── Chat JSON ───────────────────────────────────────────────────
export async function chatJSON({ provider, apiKey, model }, system, user, { maxTokens = 4096 } = {}) {
  const m = model || PROVIDERS[provider]?.defaultModel;

  if (provider === "anthropic") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: m, max_tokens: maxTokens, system,
      messages: [{ role: "user", content: user }],
    });
    return repairJSON(msg.content[0].text);
  }

  if (provider === "openai" || provider === "perplexity" || provider === "xai") {
    const text = await openaiCompatChat(
      { apiKey, model: m, baseURL: providerBase(provider) },
      [{ role: "system", content: system }, { role: "user", content: user }],
      { json: provider === "openai", maxTokens }
    );
    return repairJSON(text);
  }

  if (provider === "google") {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const gm = genAI.getGenerativeModel({
      model: m,
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: maxTokens },
    });
    const res = await gm.generateContent(`${system}\n\n${user}`);
    return repairJSON(res.response.text());
  }

  throw new Error("Unknown provider: " + provider);
}

// ─── Chat text (for agent) ────────────────────────────────────────
export async function chatText({ provider, apiKey, model }, system, messages, { maxTokens = 8000 } = {}) {
  const m = model || PROVIDERS[provider]?.defaultModel;

  if (provider === "anthropic") {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: m, max_tokens: maxTokens, system,
      messages: messages.map(x => ({ role: x.role, content: x.content })),
    });
    return msg.content[0].text;
  }

  if (provider === "openai" || provider === "perplexity" || provider === "xai") {
    return openaiCompatChat(
      { apiKey, model: m, baseURL: providerBase(provider) },
      [{ role: "system", content: system }, ...messages],
      { maxTokens }
    );
  }

  if (provider === "google") {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);
    const gm = genAI.getGenerativeModel({ model: m });
    const prompt = system + "\n\n" + messages.map(x => `${x.role}: ${x.content}`).join("\n");
    const res = await gm.generateContent(prompt);
    return res.response.text();
  }

  throw new Error("Unknown provider: " + provider);
}

// ─── Ping / connection test ───────────────────────────────────────
export async function ping({ provider, apiKey, model }) {
  try {
    const m = model || PROVIDERS[provider]?.defaultModel;
    if (provider === "anthropic") {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });
      await client.messages.create({ model: m, max_tokens: 5, messages: [{ role: "user", content: "hi" }] });
      return { ok: true };
    }
    if (provider === "openai" || provider === "perplexity" || provider === "xai") {
      await openaiCompatChat(
        { apiKey, model: m, baseURL: providerBase(provider) },
        [{ role: "user", content: "hi" }],
        { maxTokens: 5 }
      );
      return { ok: true };
    }
    if (provider === "google") {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(apiKey);
      const gm = genAI.getGenerativeModel({ model: m });
      await gm.generateContent("hi");
      return { ok: true };
    }
    return { ok: false, error: "Unknown provider" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
