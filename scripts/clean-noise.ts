import { Surreal } from "surrealdb";

const db = new Surreal();
await db.connect("ws://127.0.0.1:8002/rpc");
await db.use({ namespace: "anima", database: "memory" });
await db.signin({ username: "root", password: Deno.env.get("SURREAL_PASS") || "root" });

// Count first
const countResult = await db.query(`
  SELECT count() FROM memories
  WHERE tags CONTAINS 'hook' OR tags CONTAINS 'interaction'
  GROUP ALL
`);
const count = (countResult[0] as any[])?.[0]?.count ?? 0;
console.log(`Deleting ${count} noise memories...`);

// Delete
await db.query(`
  DELETE memories
  WHERE tags CONTAINS 'hook' OR tags CONTAINS 'interaction'
`);

// Verify
const verify = await db.query(`
  SELECT count() FROM memories
  WHERE tags CONTAINS 'hook' OR tags CONTAINS 'interaction'
  GROUP ALL
`);
const remaining = (verify[0] as any[])?.[0]?.count ?? 0;
console.log(`Remaining noise: ${remaining}`);

// Show new totals
const totals = await db.query(`
  SELECT tier, count() FROM memories GROUP BY tier
`);
console.log("Memory totals by tier:", JSON.stringify(totals[0]));

await db.close();
