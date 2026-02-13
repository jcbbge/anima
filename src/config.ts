/**
 * Configuration Module
 * 
 * Environment, database, and external providers - all in one place.
 */

import { SQL } from "bun";

// ============================================================================
// Environment
// ============================================================================

export type AppConfig = {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  encoderUrl: string;
  encoderModel: string;
};

const DEFAULTS = {
  NODE_ENV: "development",
  PORT: "7100",
  ENCODER_URL: "http://localhost:7102",
  ENCODER_MODEL: "nomic-embed-text",
} as const;

export function getConfig(): AppConfig {
  const databaseUrl = Bun.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL is required");
    process.exit(1);
  }

  return {
    nodeEnv: Bun.env.NODE_ENV || DEFAULTS.NODE_ENV,
    port: Number(Bun.env.PORT || DEFAULTS.PORT),
    databaseUrl,
    encoderUrl: Bun.env.ENCODER_URL || DEFAULTS.ENCODER_URL,
    encoderModel: Bun.env.ENCODER_MODEL || DEFAULTS.ENCODER_MODEL,
  };
}

export function displayConfig(): void {
  const config = getConfig();
  console.log("🔧 Configuration:");
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   Port: ${config.port}`);
  console.log(`   Encoder URL: ${config.encoderUrl}`);
  console.log(`   Encoder Model: ${config.encoderModel}`);
  console.log("");
}

// ============================================================================
// Database
// ============================================================================

const config = getConfig();

export const sql = new SQL({
  url: config.databaseUrl,
  max: 20,
  idleTimeout: 30,
});

export async function testConnection(): Promise<boolean> {
  try {
    const [{ now }] = await sql`SELECT NOW() as now`;
    console.log("✅ Database connected:", now);
    return true;
  } catch (error) {
    console.error("❌ Database connection failed:", (error as Error).message);
    throw error;
  }
}

export async function gracefulShutdown(): Promise<void> {
  await sql.close();
}

// ============================================================================
// Embedding Provider (simple fetch wrapper)
// ============================================================================

export async function generateProviderEmbedding(text: string, url: string, model: string): Promise<number[]> {
  const response = await fetch(`${url}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
  });

  if (!response.ok) {
    throw new Error(`Embedding service error: ${response.status}`);
  }

  const payload = await response.json();
  if (!payload?.embedding || !Array.isArray(payload.embedding)) {
    throw new Error("Invalid embedding response");
  }

  return payload.embedding;
}
