/**
 * Anima V1 API Server
 * 
 * Entry point for the Hono application.
 */

import { serve } from 'bun';
import app from './app.js';
import { getConfig, displayConfig } from './config/environment.js';
import { testConnection, closePool } from './config/database.js';

const config = getConfig();

// Display startup configuration
console.log('\n🧬 Anima V1 API Server');
console.log('========================\n');

displayConfig();

// Test database connection
try {
  await testConnection();
  console.log('');
} catch (error) {
  console.error('Failed to connect to database. Exiting...\n');
  process.exit(1);
}

// Start server
const server = serve({
  fetch: app.fetch,
  port: config.port,
  hostname: '0.0.0.0',
});

console.log(`🚀 Server running on http://localhost:${config.port}`);
console.log(`   Health check: http://localhost:${config.port}/health`);
console.log(`   API: http://localhost:${config.port}/api/v1`);
console.log('\n✨ Ready to receive requests\n');

// Graceful shutdown
const shutdown = async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Stop accepting new connections
  server.stop();
  
  // Close database connections
  await closePool();
  
  console.log('✅ Shutdown complete\n');
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
