/**
 * embed.ts
 * Ollama embedding client for Anima v2.
 * Returns embedding vectors or null on failure.
 * Fails silently — a missing embedding is recoverable; a crashed process is not.
 */

// Read lazily at call time so .env loaded by entry point is visible
function ollamaUrl()   { return Deno.env.get("OLLAMA_URL")   ?? "http://localhost:11434"; }
function ollamaModel() { return Deno.env.get("OLLAMA_MODEL") ?? "nomic-embed-text"; }
function embeddingDim() { return parseInt(Deno.env.get("EMBEDDING_DIM") ?? "768", 10); }

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${ollamaUrl()}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: ollamaModel(), prompt: text }),
      signal: AbortSignal.timeout(8000),
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
  } catch (err) {
    console.error(`[anima:embed] Embedding failed: ${(err as Error).message}`);
    return null;
  }
}
