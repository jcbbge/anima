/**
 * Embedding Service
 *
 * Generates vector embeddings using substrate-agnostic providers.
 * The service operates on abstract substrate concepts, not vendor implementations.
 *
 * Philosophy: The system must not know the origin of its cognitive substrate.
 */

import {
  getPrimarySubstrate,
  getSecondarySubstrate,
  SubstrateMap,
} from '../config/providers.js';
import { embeddingCache } from './embeddingCache.js';

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
 * Generate embedding with automatic substrate fallback
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

  // Check cache first
  const cached = await embeddingCache.get(text);
  if (cached) {
    return {
      embedding: cached,
      provider: 'cache',
      dimensions: cached.length,
      fromCache: true
    };
  }

  // Try primary substrate
  const primarySubstrate = getPrimarySubstrate();

  try {
    const embedding = await primarySubstrate.generateEmbedding(text, options);

    // Cache the result
    embeddingCache.set(text, embedding);

    return {
      embedding,
      provider: 'primary',
      dimensions: embedding.length,
      substrate: SubstrateMap.PRIMARY_ENCODER,
    };

  } catch (error) {
    // Try fallback substrate if primary fails
    const secondarySubstrate = getSecondarySubstrate();

    if (secondarySubstrate) {
      console.warn('Primary substrate failed, attempting fallback:', error.message);

      try {
        const embedding = await secondarySubstrate.generateEmbedding(text, options);

        // Cache the fallback result
        embeddingCache.set(text, embedding);

        return {
          embedding,
          provider: 'secondary',
          dimensions: embedding.length,
          substrate: SubstrateMap.SECONDARY_ENCODER,
          fallback: true,
        };
      } catch (fallbackError) {
        // Both substrates failed
        throw new EmbeddingError(
          'All substrate providers failed',
          'ALL_SUBSTRATES_FAILED',
          {
            primary: error.message,
            secondary: fallbackError.message,
          }
        );
      }
    }

    // No fallback available
    throw new EmbeddingError(
      'Primary substrate failed and no fallback configured',
      'SUBSTRATE_UNAVAILABLE',
      {
        error: error.message,
        substrate: SubstrateMap.PRIMARY_ENCODER,
      }
    );
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
      substrate: result.substrate,
    };
  } catch (error) {
    return {
      available: false,
      provider: SubstrateMap.PRIMARY_ENCODER,
      error: error.message,
      code: error.code,
    };
  }
}

export {
  generateEmbedding,
  checkAvailability,
  EmbeddingError,
};
