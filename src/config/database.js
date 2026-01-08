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
  max: 20,                     // Maximum connections
  idleTimeoutMillis: 30000,    // Close idle clients after 30s
  connectionTimeoutMillis: 2000, // Error if can't connect in 2s
});

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
 * Execute a query with error handling
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    if (config.logLevel === 'debug') {
      console.log('Query executed:', {
        text: text.substring(0, 100),
        duration: `${duration}ms`,
        rows: result.rowCount,
      });
    }
    
    return result;
  } catch (error) {
    console.error('❌ Query error:', {
      text: text.substring(0, 100),
      error: error.message,
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

export { pool, query, getClient, testConnection, closePool };
