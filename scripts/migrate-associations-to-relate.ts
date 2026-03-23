/**
 * migrate-associations-to-relate.ts
 *
 * Migrates legacy memory_associations rows to remembers relation edges.
 *
 * Run:
 *   deno run --allow-net --allow-env --allow-read scripts/migrate-associations-to-relate.ts
 */

await (async () => {
  try {
    const raw = await Deno.readTextFile(new URL("../.env", import.meta.url));
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (key && !Deno.env.get(key)) Deno.env.set(key, val);
    }
  } catch {
    // .env optional
  }
})();

import { closeDb, getDb, query } from "../lib/db.ts";

type LegacyAssociation = {
  id: string;
  memory_a: string;
  memory_b: string;
  strength?: number;
  co_occurrence?: number;
  co_occurrence_count?: number;
};

await getDb();

const associations = await query<LegacyAssociation>(
  `SELECT id, memory_a, memory_b, strength, co_occurrence, co_occurrence_count
   FROM memory_associations`,
  {},
);

console.log(`[migration] Found ${associations.length} memory_associations rows`);

let successes = 0;
let failures = 0;

for (const row of associations) {
  const strength = typeof row.strength === "number" ? row.strength : 1.0;
  const coOccurrence = typeof row.co_occurrence === "number"
    ? row.co_occurrence
    : (typeof row.co_occurrence_count === "number" ? row.co_occurrence_count : 1);

  try {
    await query(
      `RELATE $a->remembers->$b
       SET strength = $strength,
           co_occurrence = $co_occurrence,
           created_at = time::now(),
           updated_at = time::now()`,
      {
        a: row.memory_a,
        b: row.memory_b,
        strength,
        co_occurrence: coOccurrence,
      },
    );
    successes++;
  } catch (err) {
    failures++;
    console.error(
      `[migration] Failed ${row.id} (${row.memory_a} -> ${row.memory_b}): ${(err as Error).message}`,
    );
  }
}

const remembersCountRows = await query<{ count: number }>(
  `SELECT count() AS count FROM remembers GROUP ALL`,
  {},
);
const remembersCount = remembersCountRows[0]?.count ?? 0;

console.log("[migration] Summary");
console.log(`  source rows:      ${associations.length}`);
console.log(`  migrated success: ${successes}`);
console.log(`  migrated failed:  ${failures}`);
console.log(`  remembers count:  ${remembersCount}`);
console.log(`  counts match:     ${remembersCount === associations.length ? "yes" : "no"}`);

await closeDb();
