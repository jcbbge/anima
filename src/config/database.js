/**
 * Database Connection Pool
 * 
 * PostgreSQL connection pool using pg library.
 * Handles connections, errors, and graceful shutdown.
 */

import pg from 'pg';
import { getConfig } from './environment.js';

const { Pool } = pg;
const config = getConfig();

/**
 * Create connection pool
 */
const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,

  // Connection pool settings
  max: 50,                      // UP from 20 - support 50 concurrent users
  idleTimeoutMillis: 30000,     // Keep at 30s
  connectionTimeoutMillis: 5000, // UP from 2000 - handle cold starts
});

// NEW: Pool metrics logging
setInterval(() => {
  const stats = {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };

  if (config.logLevel === 'debug' || stats.waiting > 0) {
    console.log('[POOL]', stats);
  }

  // Warn if pool exhausted
  if (stats.waiting > 5) {
    console.warn('⚠️  Connection pool under pressure:', stats);
  }
}, 60000); // Every minute

/**
 * Handle pool errors
 */
pool.on('error', (err, client) => {
  console.error('❌ Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Test connection on startup
 */
async function testConnection() {
  try {
    const result = await pool.query('SELECT NOW() as now, version() as version');
    console.log('✅ Database connected:', result.rows[0].now);
    console.log('   PostgreSQL version:', result.rows[0].version.split(' ')[1]);
    
    // Verify pgvector extension
    const extResult = await pool.query(
      "SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'"
    );
    
    if (extResult.rows.length > 0) {
      console.log('   pgvector version:', extResult.rows[0].extversion);
    } else {
      console.warn('⚠️  pgvector extension not found');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  }
}

/**
 * Gracefully close pool
 */
async function closePool() {
  console.log('🔌 Closing database connections...');
  await pool.end();
  console.log('✅ Database connections closed');
}

/**
 * Schema management for test isolation
 */
let currentSchema = 'public';

/**
 * Set the database schema for subsequent queries
 * @param {string} schema - Schema name to use
 */
function setDatabaseSchema(schema) {
  currentSchema = schema;
}

/**
 * Get the current database schema
 * @returns {string} Current schema name
 */
function getDatabaseSchema() {
  return currentSchema;
}

/**
 * Execute a query with error handling
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function query(text, params) {
  const start = Date.now();

  // For non-public schemas, we need to use a client and set search_path
  if (currentSchema !== 'public') {
    const client = await pool.connect();
    try {
      // Set search_path for this client
      await client.query(`SET search_path TO ${currentSchema}, public`);

      // Execute the actual query
      const result = await client.query(text, params);
      const duration = Date.now() - start;

      if (config.logLevel === 'debug') {
        console.log('Query executed:', {
          text: text.substring(0, 100),
          duration: `${duration}ms`,
          rows: result.rowCount,
          schema: currentSchema,
        });
      }

      return result;
    } catch (error) {
      console.error('❌ Query error:', {
        text: text.substring(0, 100),
        error: error.message,
        schema: currentSchema,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  // For public schema, use pool directly (faster)
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    if (config.logLevel === 'debug') {
      console.log('Query executed:', {
        text: text.substring(0, 100),
        duration: `${duration}ms`,
        rows: result.rowCount,
        schema: currentSchema,
      });
    }

    return result;
  } catch (error) {
    console.error('❌ Query error:', {
      text: text.substring(0, 100),
      error: error.message,
      schema: currentSchema,
    });
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 * @returns {Promise<Object>} Database client
 */
async function getClient() {
  return await pool.connect();
}

// Setup graceful shutdown handlers
process.on('SIGTERM', async () => {
  console.log('SIGTERM received');
  await closePool();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\nSIGINT received');
  await closePool();
  process.exit(0);
});

export { pool, query, getClient, testConnection, closePool, setDatabaseSchema, getDatabaseSchema };
