/**
 * Environment Configuration and Validation
 * 
 * Validates required environment variables and provides defaults.
 * Exits with error if critical variables are missing.
 */

import dotenv from 'dotenv';

// Load .env file
dotenv.config();

/**
 * Required environment variables
 */
const REQUIRED_VARS = [
  'POSTGRES_PASSWORD',
];

/**
 * Optional environment variables with defaults
 */
const DEFAULTS = {
  NODE_ENV: 'development',
  PORT: '7100',
  POSTGRES_HOST: 'localhost',
  POSTGRES_PORT: '7101',
  POSTGRES_DB: 'anima',
  POSTGRES_USER: 'anima',
  EMBEDDING_PROVIDER: 'ollama',
  OLLAMA_URL: 'http://localhost:7102',
  LOG_LEVEL: 'info',
  ENABLE_SEMANTIC_CONSOLIDATION: 'true',
};

/**
 * Validate environment variables
 * @throws {Error} If required variables are missing
 */
function validateEnvironment() {
  const missing = [];
  
  // Check required variables
  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('\nPlease set these in your .env file or environment.');
    process.exit(1);
  }

  // Validate EMBEDDING_PROVIDER specific requirements
  if (process.env.EMBEDDING_PROVIDER === 'openai' && !process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai');
    console.error('   Set OPENAI_API_KEY in your .env file or switch to EMBEDDING_PROVIDER=ollama');
    process.exit(1);
  }

  // Apply defaults for missing optional variables
  for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
    if (!process.env[key]) {
      process.env[key] = defaultValue;
    }
  }
}

/**
 * Get configuration object
 * @returns {Object} Configuration object
 */
function getConfig() {
  return {
    // Node environment
    nodeEnv: process.env.NODE_ENV,
    port: parseInt(process.env.PORT, 10),
    
    // Database
    database: {
      host: process.env.POSTGRES_HOST,
      port: parseInt(process.env.POSTGRES_PORT, 10),
      database: process.env.POSTGRES_DB,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
    },
    
    // Embedding provider
    embedding: {
      provider: process.env.EMBEDDING_PROVIDER,
      ollamaUrl: process.env.OLLAMA_URL,
      openaiApiKey: process.env.OPENAI_API_KEY,
    },

    // Logging
    logLevel: process.env.LOG_LEVEL,

    // Features
    features: {
      semanticConsolidation: process.env.ENABLE_SEMANTIC_CONSOLIDATION === 'true',
    },
  };
}

/**
 * Display configuration (without secrets)
 */
function displayConfig() {
  const config = getConfig();
  
  console.log('🔧 Configuration:');
  console.log(`   Environment: ${config.nodeEnv}`);
  console.log(`   Port: ${config.port}`);
  console.log(`   Database: ${config.database.host}:${config.database.port}/${config.database.database}`);
  console.log(`   Embedding Provider: ${config.embedding.provider}`);
  if (config.embedding.provider === 'ollama') {
    console.log(`   Ollama URL: ${config.embedding.ollamaUrl}`);
  }
  console.log(`   Log Level: ${config.logLevel}`);
  console.log('');
}

// Validate on import
validateEnvironment();

export { validateEnvironment, getConfig, displayConfig };
