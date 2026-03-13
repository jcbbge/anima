/**
 * embed.ts
 * Ollama embedding client for Anima v2.
 * Returns embedding vectors or null on failure.
 * Fails silently — a missing embedding is recoverable; a crashed process is not.
 *
 * Hardening:
 * - First attempt uses 20s timeout to handle cold model load (~400ms) with headroom
 * - Single retry on failure with standard 8s timeout
 * - prewarmEmbedding() can be called at service startup to avoid first-request cold penalty
 */

function ollamaUrl()    { return Deno.env.get("OLLAMA_URL")    ?? "http://localhost:8001"; }
function ollamaModel()  { return Deno.env.get("OLLAMA_MODEL")  ?? "nomic-embed-text"; }
function embeddingDim() { return parseInt(Deno.env.get("EMBEDDING_DIM") ?? "768", 10); }

const FIRST_TIMEOUT_MS = 20_000; // generous for cold model load
const RETRY_TIMEOUT_MS =  8_000; // standard for warm calls

async function fetchEmbedding(text: string, timeoutMs: number): Promise<number[] | null> {
  const res = await fetch(`${ollamaUrl()}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: ollamaModel(), prompt: text }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    console.error(`[anima:embed] Ollama error: ${res.status}`);
    return null;
  }

  const { embedding } = await res.json();
  const expectedDim = embeddingDim();

  if (!Array.isArray(embedding) || embedding.length !== expectedDim) {
    console.error(`[anima:embed] Unexpected embedding shape: got ${embedding?.length}, expected ${expectedDim}`);
    return null;
  }

  return embedding as number[];
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    // First attempt: long timeout to handle cold model load
    const result = await fetchEmbedding(text, FIRST_TIMEOUT_MS);
    if (result) return result;
  } catch (err) {
    console.error(`[anima:embed] First attempt failed (${(err as Error).message}), retrying...`);
  }

  try {
    // Single retry with standard timeout
    return await fetchEmbedding(text, RETRY_TIMEOUT_MS);
  } catch (err) {
    console.error(`[anima:embed] Embedding failed: ${(err as Error).message}`);
    return null;
  }
}

/**
 * prewarmEmbedding — call at service startup to load model into memory.
 * Avoids first-request cold start penalty during synthesis.
 */
export async function prewarmEmbedding(): Promise<void> {
  try {
    console.error("[anima:embed] Prewarming embedding model...");
    const result = await fetchEmbedding("prewarm", FIRST_TIMEOUT_MS);
    if (result) {
      console.error("[anima:embed] Model warm and ready.");
    } else {
      console.error("[anima:embed] Prewarm returned no result — model may be unavailable.");
    }
  } catch (err) {
    console.error(`[anima:embed] Prewarm failed: ${(err as Error).message}`);
  }
}
