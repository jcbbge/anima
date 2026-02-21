/**
 * embed.ts
 * Ollama embedding client for Anima v2.
 * Returns 768-dim nomic-embed-text vectors or null on failure.
 * Fails silently — a missing embedding is recoverable; a crashed process is not.
 */

const OLLAMA_URL   = Deno.env.get("OLLAMA_URL")   ?? "http://localhost:11434";
const OLLAMA_MODEL = Deno.env.get("OLLAMA_MODEL") ?? "nomic-embed-text";

export async function generateEmbedding(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.error(`[anima:embed] Ollama error: ${res.status}`);
      return null;
    }

    const { embedding } = await res.json();

    if (!Array.isArray(embedding) || embedding.length !== 768) {
      console.error(`[anima:embed] Unexpected embedding shape: ${embedding?.length}`);
      return null;
    }

    return embedding as number[];
  } catch (err) {
    console.error(`[anima:embed] Embedding failed: ${(err as Error).message}`);
    return null;
  }
}
