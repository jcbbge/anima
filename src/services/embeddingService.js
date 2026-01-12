/**
 * Embedding Service
 * 
 * Generates vector embeddings using Ollama (local) or OpenAI (fallback).
 * Includes retry logic, timeouts, and proper error handling.
 */

import axios from 'axios';
import { getConfig } from '../config/environment.js';
import { embeddingCache } from './embeddingCache.js';

const config = getConfig();

/**
 * Custom error class for embedding service errors
 */
class EmbeddingError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'EmbeddingError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Sleep helper for retry backoff
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generate embedding using Ollama
 * 
 * @param {string} text - Text to embed
 * @param {Object} options - Generation options
 * @returns {Promise<number[]>} 768-dimensional embedding vector
 */
async function generateEmbeddingOllama(text, options = {}) {
  const {
    model = 'nomic-embed-text',
    timeout = 5000,
    maxRetries = 3,
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(
        `${config.embedding.ollamaUrl}/api/embeddings`,
        {
          model,
          prompt: text,
        },
        {
          timeout,
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.data || !response.data.embedding) {
        throw new EmbeddingError(
          'Invalid response from Ollama',
          'INVALID_RESPONSE',
          { response: response.data }
        );
      }

      const embedding = response.data.embedding;

      // Validate embedding dimensions (nomic-embed-text returns 768)
      const expectedDimensions = 768;
      if (!Array.isArray(embedding)) {
        throw new EmbeddingError(
          'Embedding must be an array',
          'INVALID_EMBEDDING_TYPE',
          { type: typeof embedding }
        );
      }
      
      if (embedding.length !== expectedDimensions) {
        throw new EmbeddingError(
          `Expected ${expectedDimensions} dimensions, got ${embedding.length}`,
          'INVALID_DIMENSIONS',
          { expected: expectedDimensions, actual: embedding.length }
        );
      }

      return embedding;

    } catch (error) {
      lastError = error;

      // Don't retry on validation errors
      if (error instanceof EmbeddingError) {
        throw error;
      }

      // Log retry attempt
      if (attempt < maxRetries) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.warn(`Ollama embedding attempt ${attempt} failed, retrying in ${backoffMs}ms:`, error.message);
        await sleep(backoffMs);
      }
    }
  }

  // All retries failed
  throw new EmbeddingError(
    'Failed to generate embedding after retries',
    'OLLAMA_UNAVAILABLE',
    {
      attempts: maxRetries,
      lastError: lastError.message,
      ollamaUrl: config.embedding.ollamaUrl,
    }
  );
}

/**
 * Generate embedding using OpenAI
 * 
 * @param {string} text - Text to embed
 * @param {Object} options - Generation options
 * @returns {Promise<number[]>} 1536-dimensional embedding vector (OpenAI)
 */
async function generateEmbeddingOpenAI(text, options = {}) {
  const {
    model = 'text-embedding-3-small',
    timeout = 10000,
    dimensions = 768, // Match Ollama dimensions (nomic-embed-text)
  } = options;

  if (!config.embedding.openaiApiKey) {
    throw new EmbeddingError(
      'OpenAI API key not configured',
      'MISSING_API_KEY'
    );
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/embeddings',
      {
        model,
        input: text,
        dimensions, // text-embedding-3-small supports custom dimensions
      },
      {
        timeout,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.embedding.openaiApiKey}`,
        },
      }
    );

    if (!response.data || !response.data.data || !response.data.data[0]) {
      throw new EmbeddingError(
        'Invalid response from OpenAI',
        'INVALID_RESPONSE',
        { response: response.data }
      );
    }

    return response.data.data[0].embedding;

  } catch (error) {
    if (error instanceof EmbeddingError) {
      throw error;
    }

    throw new EmbeddingError(
      'Failed to generate OpenAI embedding',
      'OPENAI_ERROR',
      {
        message: error.message,
        status: error.response?.status,
      }
    );
  }
}

/**
 * Generate embedding with automatic provider fallback
 * 
 * @param {string} text - Text to embed
 * @param {Object} options - Generation options
 * @returns {Promise<{embedding: number[], provider: string, dimensions: number}>}
 */
async function generateEmbedding(text, options = {}) {
  if (!text || typeof text !== 'string') {
    throw new EmbeddingError(
      'Text must be a non-empty string',
      'INVALID_INPUT',
      { text: typeof text }
    );
  }

  if (text.length === 0) {
    throw new EmbeddingError(
      'Text cannot be empty',
      'EMPTY_INPUT'
    );
  }

  // NEW: Check cache first
  const cached = await embeddingCache.get(text);
  if (cached) {
    return {
      embedding: cached,
      provider: 'cache',
      dimensions: cached.length,
      fromCache: true
    };
  }

  // Try primary provider
  const primaryProvider = config.embedding.provider;

  try {
    let embedding;

    if (primaryProvider === 'ollama') {
      embedding = await generateEmbeddingOllama(text, options);

      // NEW: Cache the result
      embeddingCache.set(text, embedding);

      return {
        embedding,
        provider: 'ollama',
        dimensions: embedding.length,
        model: 'nomic-embed-text',
      };
    } else if (primaryProvider === 'openai') {
      embedding = await generateEmbeddingOpenAI(text, options);

      // NEW: Cache the result
      embeddingCache.set(text, embedding);

      return {
        embedding,
        provider: 'openai',
        dimensions: embedding.length,
        model: 'text-embedding-3-small',
      };
    } else {
      throw new EmbeddingError(
        `Unknown provider: ${primaryProvider}`,
        'INVALID_PROVIDER',
        { provider: primaryProvider }
      );
    }

  } catch (error) {
    // Try fallback if primary fails
    if (primaryProvider === 'ollama' && config.embedding.openaiApiKey) {
      console.warn('Ollama failed, falling back to OpenAI:', error.message);
      try {
        const embedding = await generateEmbeddingOpenAI(text, options);

        // NEW: Cache the fallback result
        embeddingCache.set(text, embedding);

        return {
          embedding,
          provider: 'openai',
          dimensions: embedding.length,
          model: 'text-embedding-3-small',
          fallback: true,
        };
      } catch (fallbackError) {
        // Both failed
        throw new EmbeddingError(
          'Both Ollama and OpenAI failed',
          'ALL_PROVIDERS_FAILED',
          {
            primary: error.message,
            fallback: fallbackError.message,
          }
        );
      }
    }

    // No fallback available or fallback already failed
    throw error;
  }
}

/**
 * Check if embedding service is available
 * 
 * @returns {Promise<{available: boolean, provider: string, error?: string}>}
 */
async function checkAvailability() {
  try {
    const testText = "test";
    const result = await generateEmbedding(testText, { timeout: 2000, maxRetries: 1 });
    return {
      available: true,
      provider: result.provider,
      dimensions: result.dimensions,
      model: result.model,
    };
  } catch (error) {
    return {
      available: false,
      provider: config.embedding.provider,
      error: error.message,
      code: error.code,
    };
  }
}

export {
  generateEmbedding,
  generateEmbeddingOllama,
  generateEmbeddingOpenAI,
  checkAvailability,
  EmbeddingError,
};
