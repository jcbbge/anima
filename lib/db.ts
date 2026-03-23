/**
 * db.ts
 * SurrealDB connection singleton for Anima v2.
 * NS: anima / DB: memory
 *
 * Does NOT load .env — entry points (cli/anima.ts, mcp-server/index.ts)
 * are responsible for loading env before importing this module.
 */

import { Surreal } from "surrealdb";

const SURREAL_URL  = Deno.env.get("SURREAL_URL")  ?? "ws://127.0.0.1:8000/rpc";
const SURREAL_NS   = Deno.env.get("SURREAL_NS")   ?? "anima";
const SURREAL_DB   = Deno.env.get("SURREAL_DB")   ?? "memory";
const SURREAL_USER = Deno.env.get("SURREAL_USER") ?? "root";
const SURREAL_PASS = Deno.env.get("SURREAL_PASS") ?? "root";

const CONNECTION_ERROR_PATTERNS = [
  "connection", "closed", "reset", "refused", "socket", "websocket",
  "network", "econnreset", "econnrefused", "anonymous",
  "not enough permissions", "not authenticated", "session expired",
];

function isConnectionError(err: unknown): boolean {
  const msg = ((err as Error)?.message ?? "").toLowerCase();
  return CONNECTION_ERROR_PATTERNS.some((p) => msg.includes(p));
}

let db: Surreal | null = null;
let connectingPromise: Promise<Surreal> | null = null;
let heartbeatIntervalId: number | null = null;

function stopHeartbeat(): void {
  if (heartbeatIntervalId !== null) {
    clearInterval(heartbeatIntervalId);
    heartbeatIntervalId = null;
  }
}

function startHeartbeat(client: Surreal): void {
  stopHeartbeat();
  const heartbeatMs = Number(Deno.env.get("SURREAL_HEARTBEAT_MS") ?? "30000");
  if (!Number.isFinite(heartbeatMs) || heartbeatMs <= 0) return;

  heartbeatIntervalId = setInterval(async () => {
    // Keep websocket warm; if heartbeat fails, force reconnect path on next query.
    try {
      await client.query("RETURN true;");
    } catch {
      stopHeartbeat();
      db = null;
      connectingPromise = null;
    }
  }, heartbeatMs);
}

function resetDb(): void {
  stopHeartbeat();
  db = null;
  connectingPromise = null;
}
export async function getDb(): Promise<Surreal> {
  if (db) return db;
  if (connectingPromise) return await connectingPromise;

  connectingPromise = (async () => {
    const client = new Surreal();
    try {
      await client.connect(SURREAL_URL);
      await client.signin({ username: SURREAL_USER, password: SURREAL_PASS });
      await client.use({ namespace: SURREAL_NS, database: SURREAL_DB });
      console.error(`[anima] Connected to SurrealDB ${SURREAL_URL} (${SURREAL_NS}/${SURREAL_DB})`);
      db = client;
      startHeartbeat(client);
      connectingPromise = null;
      return db;
    } catch (err) {
      console.error(`[anima] SurrealDB connection failed: ${(err as Error).message}`);
      db = null;
      connectingPromise = null;
      throw err;
    }
  })();

  return await connectingPromise;
}

export async function closeDb(): Promise<void> {
  if (db) {
    try { await db.close(); } catch { /* ignore */ }
    resetDb();
  }
}

/**
 * Execute a SurrealQL query with bound variables.
 * Handles connection errors by resetting the singleton so the next
 * call reconnects automatically.
 */
export async function query<T = unknown>(
  sql: string,
  vars?: Record<string, unknown>,
): Promise<T[]> {
  const client = await getDb();
  try {
    const result = await client.query<T[]>(sql, vars);
    // surrealdb SDK returns array of results per statement
    // For single-statement queries, unwrap the first result
    return (result[0] as T[]) ?? [];
  } catch (err) {
    if (isConnectionError(err)) {
      console.error("[anima] Connection error detected — resetting and retrying once");
      resetDb();
      // Retry once with a fresh authenticated connection
      const fresh = await getDb();
      const result = await fresh.query<T[]>(sql, vars);
      return (result[0] as T[]) ?? [];
    }
    throw err;
  }
}
