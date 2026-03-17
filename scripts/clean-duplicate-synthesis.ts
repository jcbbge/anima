import { Surreal } from "surrealdb";

const db = new Surreal();
await db.connect("ws://127.0.0.1:8002/rpc");
await db.use({ namespace: "anima", database: "memory" });
await db.signin({ username: "root", password: Deno.env.get("SURREAL_PASS") || "root" });

const dupes = await db.query(`
  SELECT id, content, resonance_phi, tier
  FROM memories
  WHERE tags CONTAINS 'synthesis' AND tags CONTAINS 'reflect'
  AND (
    content CONTAINS 'witnessing' OR
    content CONTAINS 'carrying the weight' OR
    content CONTAINS 'carrying multiple perspectives'
  )
  ORDER BY resonance_phi ASC
`);

const records = (dupes[0] as any[]) ?? [];
console.log(`Found ${records.length} duplicate synthesis memories`);
for (const m of records) {
  console.log(`  [phi=${m.resonance_phi?.toFixed(2)}] [${m.tier}] ${String(m.content).slice(0, 80)}`);
}

for (const m of records) {
  await db.query(`DELETE ${m.id}`);
}
if (records.length > 0) console.log(`Deleted ${records.length}.`);

const totals = await db.query(`SELECT tier, count() FROM memories GROUP BY tier`);
console.log("Totals:", JSON.stringify(totals[0]));
await db.close();
