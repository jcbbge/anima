/**
 * lib/llm.ts
 * OpenRouter-first LLM abstraction for Anima.
 *
 * Notes:
 * - OpenRouter is the only normal/provider path.
 * - Ollama is intentionally NOT a selectable provider; it is only used as an
 *   emergency, last-resort local fallback for synthesis.
 */
// ============================================================================
// Endpoints / headers
// ============================================================================

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_REFERER = "https://github.com/anima";
const OPENROUTER_TITLE = "Anima Memory System";

// Emergency local fallback only (not a normal provider path)
const OLLAMA_FALLBACK_MODEL = "qwen2.5:0.5b";
const OLLAMA_FALLBACK_CHAT_PATH = "/v1/chat/completions";

// ============================================================================
// Profiles
// ============================================================================

export interface ModelProfile {
  primary: string;
  fallback1: string;
  fallback2: string;
}

export const PROFILES = {
  default: {
    primary: "meta-llama/llama-3.3-70b-instruct",
    fallback1: "meta-llama/llama-3.1-8b-instruct",
    fallback2: "mistralai/mistral-7b-instruct",
  },
  fast: {
    primary: "meta-llama/llama-3.1-8b-instruct",
    fallback1: "mistralai/mistral-7b-instruct",
    fallback2: "meta-llama/llama-3.3-70b-instruct",
  },
  capable: {
    primary: "meta-llama/llama-3.3-70b-instruct",
    fallback1: "mistralai/mistral-7b-instruct",
    fallback2: "meta-llama/llama-3.1-8b-instruct",
  },
} as const satisfies Record<string, ModelProfile>;

export function listProfiles(): typeof PROFILES {
  return PROFILES;
}

function resolveProfile(
  name: string | undefined,
  fallback: keyof typeof PROFILES,
): {
  name: keyof typeof PROFILES;
  profile: ModelProfile;
} {
  const candidate = (name ?? fallback) as keyof typeof PROFILES;
  if (candidate in PROFILES) {
    return { name: candidate, profile: PROFILES[candidate] };
  }
  console.error(
    `[anima:llm] unknown profile "${candidate}", falling back to "${fallback}"`,
  );
  return { name: fallback, profile: PROFILES[fallback] };
}

function orderedUnique(models: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const model of models) {
    const trimmed = model.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

// ============================================================================
// Resolved config
// ============================================================================

export interface LLMConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
}

interface ResolvedProfileConfig {
  profileName: keyof typeof PROFILES;
  profile: ModelProfile;
  primaryModel: string;
  temperature: number;
  maxTokens: number;
}

export function resolveSynthesisConfig(): LLMConfig {
  const resolved = resolveSynthesisProfileConfig();
  return {
    model: resolved.primaryModel,
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
  };
}

export function resolveGraderConfig(): LLMConfig {
  const resolved = resolveGraderProfileConfig();
  return {
    model: resolved.primaryModel,
    temperature: resolved.temperature,
    maxTokens: resolved.maxTokens,
  };
}

function resolveSynthesisProfileConfig(): ResolvedProfileConfig {
  const { name, profile } = resolveProfile(
    Deno.env.get("SYNTHESIS_PROFILE") ?? "default",
    "default",
  );
  return {
    profileName: name,
    profile,
    primaryModel: profile.primary,
    temperature: 0.7,
    maxTokens: 200,
  };
}

function resolveGraderProfileConfig(): ResolvedProfileConfig {
  const { name, profile } = resolveProfile(
    Deno.env.get("GRADER_PROFILE") ?? "capable",
    "capable",
  );
  return {
    profileName: name,
    profile,
    primaryModel: profile.primary,
    temperature: 0.2,
    maxTokens: 400,
  };
}
// ============================================================================
// Core call
// ============================================================================

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCallOptions {
  config?: LLMConfig; // explicit model config (benchmark/override use)
  role?: "synthesis" | "grader"; // if config omitted, role decides profile
  timeoutMs?: number;
}

async function callOpenRouter(
  messages: ChatMessage[],
  config: LLMConfig,
  timeoutMs: number,
): Promise<string | null> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  if (!apiKey) {
    console.error("[anima:llm] OPENROUTER_API_KEY is missing");
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
    "HTTP-Referer": OPENROUTER_REFERER,
    "X-OpenRouter-Title": OPENROUTER_TITLE,
  };

  try {
    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false,
        temperature: config.temperature ?? 0.7,
        max_tokens: config.maxTokens ?? 200,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[anima:llm] openrouter/${config.model} error ${res.status}: ${
          body.slice(0, 300)
        }`,
      );
      return null;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (err) {
    console.error(
      `[anima:llm] openrouter/${config.model} failed: ${
        (err as Error).message
      }`,
    );
    return null;
  }
}

/**
 * Emergency local fallback only.
 *
 * IMPORTANT: This is intentionally not part of normal provider selection.
 * It is only used as a final fallback after all OpenRouter models fail.
 */
async function callLocalOllamaFallback(
  messages: ChatMessage[],
  timeoutMs: number,
): Promise<string | null> {
  const ollamaUrl = Deno.env.get("OLLAMA_URL") ?? "http://localhost:8001";
  const url = `${ollamaUrl}${OLLAMA_FALLBACK_CHAT_PATH}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_FALLBACK_MODEL,
        messages,
        stream: false,
        temperature: 0.7,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[anima:llm] ollama/${OLLAMA_FALLBACK_MODEL} error ${res.status}: ${
          body.slice(0, 300)
        }`,
      );
      return null;
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (err) {
    console.error(
      `[anima:llm] ollama/${OLLAMA_FALLBACK_MODEL} failed: ${
        (err as Error).message
      }`,
    );
    return null;
  }
}

export async function callLLMRaw(
  messages: ChatMessage[],
  options: LLMCallOptions = {},
): Promise<string | null> {
  let config: LLMConfig;

  if (options.config) {
    config = options.config;
  } else if (options.role === "grader") {
    config = resolveGraderConfig();
  } else {
    config = resolveSynthesisConfig();
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  return await callOpenRouter(messages, config, timeoutMs);
}

// ============================================================================
// Convenience: synthesis call (used by synthesize.ts)
// ============================================================================

/**
 * Call synthesis models in order:
 * 1) profile primary
 * 2) profile fallback1
 * 3) profile fallback2
 * 4) emergency local Ollama fallback (qwen2.5:0.5b)
 */
export async function callSynthesisLLM(
  messages: ChatMessage[],
  timeoutMs = 30_000,
): Promise<{ content: string | null; model: string }> {
  const resolved = resolveSynthesisProfileConfig();
  const modelsToTry = orderedUnique([
    resolved.primaryModel,
    resolved.profile.fallback1,
    resolved.profile.fallback2,
  ]);

  for (const model of modelsToTry) {
    const content = await callOpenRouter(messages, {
      model,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
    }, timeoutMs);

    if (content) {
      return { content, model };
    }
  }

  throw new Error(
    `[anima:llm] all OpenRouter synthesis models failed (tried: ${modelsToTry.join(", ")}). ` +
    `Check OPENROUTER_API_KEY and model availability.`,
  );
}

// ============================================================================
// Convenience: grader call (used by benchmark)
// ============================================================================

export async function callGraderLLM(
  messages: ChatMessage[],
  timeoutMs = 45_000,
): Promise<string | null> {
  const resolved = resolveGraderProfileConfig();
  const modelsToTry = orderedUnique([
    resolved.primaryModel,
    resolved.profile.fallback1,
    resolved.profile.fallback2,
  ]);

  for (const model of modelsToTry) {
    const content = await callOpenRouter(messages, {
      model,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
    }, timeoutMs);

    if (content) return content;
  }

  console.error(
    "[anima:llm] grader failed: all OpenRouter profile models failed",
  );
  return null;
}

// ============================================================================
// Describe current config (for CLI / benchmark output)
// ============================================================================

export async function describeSynthesisConfig(): Promise<string> {
  const resolved = resolveSynthesisProfileConfig();
  return `openrouter/${resolved.primaryModel} [profile:${resolved.profileName}]`;
}

export function describeGraderConfig(): string {
  const resolved = resolveGraderProfileConfig();
  return `openrouter/${resolved.primaryModel} [profile:${resolved.profileName}]`;
}
