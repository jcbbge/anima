/**
 * backfill_embeddings.ts
 * Re-embeds all memories that have no embedding.
 * Run: deno run --allow-net --allow-env --allow-read scripts/backfill_embeddings.ts
 */
import { getDb, closeDb, query } from "../lib/db.ts";
import { generateEmbedding } from "../lib/embed.ts";

await getDb();

const missing = await query<{ id: string; content: string; created_at: string }>(
  "SELECT id, content, created_at FROM memories WHERE embedding IS NONE AND deleted_at IS NONE ORDER BY created_at ASC",
  {}
);
console.log(`Found ${missing.length} memories without embeddings`);

let success = 0;
let failed = 0;

for (const mem of missing) {
  try {
    const embedding = await generateEmbedding(mem.content);
    if (embedding) {
      await query(
        "UPDATE memories SET embedding = $embedding, updated_at = time::now() WHERE id = $id",
        { id: mem.id, embedding }
      );
      success++;
      if (success % 10 === 0) console.log(`Progress: ${success}/${missing.length} embedded`);
    } else {
      failed++;
      console.error(`No embedding returned for ${mem.id}`);
    }
  } catch (err) {
    failed++;
    console.error(`Failed ${mem.id}: ${(err as Error).message}`);
  }
  // Small delay to avoid hammering Ollama
  await new Promise(r => setTimeout(r, 200));
}

console.log(`Done. Success: ${success}, Failed: ${failed}`);
await closeDb();