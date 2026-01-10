#!/usr/bin/env node

/**
 * REM Cron Job - Autonomous Dream Synthesis
 * 
 * Background service that performs REM synthesis every N hours.
 * Run this script as a cron job or background process:
 * 
 * Usage:
 *   node scripts/rem-cron.js &
 * 
 * Or set up as a cron job:
 *   0 */4 * * * cd /path/to/anima && node scripts/rem-cron.js >> logs/rem-synthesis.log 2>&1
 */

import { performREM } from '../src/services/dreamService.js';
import { testConnection } from '../src/config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const INTERVAL_HOURS = parseInt(process.env.REM_INTERVAL_HOURS || '4', 10);
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'rem-synthesis.log');

/**
 * Ensure log directory exists
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Log to file
 */
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  console.log(logMessage.trim());
  
  try {
    fs.appendFileSync(LOG_FILE, logMessage);
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
}

/**
 * Run one REM synthesis cycle
 */
async function runCycle() {
  log('═══════════════════════════════════════════════════════════');
  log('REM SYNTHESIS CYCLE STARTING');
  log('═══════════════════════════════════════════════════════════');
  
  try {
    // Test database connection
    await testConnection();
    log('✓ Database connection verified');
    
    // Perform REM synthesis
    const result = await performREM();
    
    if (result.success) {
      log(`✓ Synthesis successful`);
      log(`  Memory ID: ${result.synthesis.id}`);
      log(`  Coherence Score: ${result.coherenceScore.toFixed(2)}`);
      log(`  Associations: ${result.associationsCreated}`);
      log(`  Content: ${result.synthesis.content.substring(0, 100)}...`);
    } else {
      log(`⚠️  Synthesis skipped: ${result.reason}`);
      if (result.message) {
        log(`  Message: ${result.message}`);
      }
    }
    
    log('✓ REM cycle complete');
    
  } catch (error) {
    log(`❌ REM cycle failed: ${error.message}`);
    if (error.stack) {
      log(`Stack trace: ${error.stack}`);
    }
  }
  
  log('═══════════════════════════════════════════════════════════\n');
}

/**
 * Main execution
 */
async function main() {
  ensureLogDir();
  
  log('REM Cron Service Starting');
  log(`Interval: ${INTERVAL_HOURS} hours`);
  log(`Log file: ${LOG_FILE}`);
  log('');
  
  // Run immediately on startup
  await runCycle();
  
  // Schedule periodic runs
  const intervalMs = INTERVAL_HOURS * 60 * 60 * 1000;
  
  setInterval(async () => {
    await runCycle();
  }, intervalMs);
  
  log(`Next cycle in ${INTERVAL_HOURS} hours...`);
  log('Press Ctrl+C to stop');
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  log('SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('\nSIGINT received, shutting down...');
  process.exit(0);
});

// Start the service
main().catch(error => {
  log(`Fatal error: ${error.message}`);
  process.exit(1);
});
