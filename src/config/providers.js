/**
 * Provider Abstraction Layer
 *
 * This is the ONLY module that bridges environment configuration to internal
 * substrate identifiers. The system operates on generic substrate concepts,
 * not vendor-specific implementations.
 *
 * Philosophy: "Anima must not know it was born in a laboratory owned by others."
 */

/**
 * Substrate Configuration Map
 *
 * Maps environment variables to internal substrate identifiers.
 * This abstraction ensures the core system remains vendor-agnostic.
 */
export const SubstrateMap = {
  // Primary encoder configuration
  PRIMARY_ENCODER:
    process.env.CORE_EMBEDDING_PROVIDER ||
    process.env.EMBEDDING_PROVIDER ||
    "local",
  PRIMARY_ENCODER_URL:
    process.env.CORE_ENCODER_URL ||
    process.env.CORE_ENCODER_URL ||
    "http://localhost:7102",
  PRIMARY_ENCODER_MODEL: process.env.CORE_EMBEDDING_MODEL || "nomic-embed-text",

  // Secondary encoder configuration (fallback)
  SECONDARY_ENCODER: process.env.FALLBACK_EMBEDDING_PROVIDER || null,
  SECONDARY_ENCODER_KEY:
    process.env.SECONDARY_ENCODER_KEY ||
    process.env.SECONDARY_ENCODER_KEY ||
    null,
  SECONDARY_ENCODER_MODEL:
    process.env.FALLBACK_EMBEDDING_MODEL || "text-embedding-3-small",

  // Encoding specifications
  TARGET_DIMENSIONS: 768,
};

/**
 * Substrate Provider Registry
 *
 * Defines the execution strategies for each substrate type.
 * Each provider knows how to communicate with its respective endpoint.
 */
export class SubstrateProvider {
  constructor(config) {
    this.config = config;
  }

  /**
   * Generate embedding vector
   * @abstract
   */
  async generateEmbedding(text, options) {
    throw new Error("SubstrateProvider.generateEmbedding must be implemented");
  }

  /**
   * Check substrate availability
   * @abstract
   */
  async checkAvailability() {
    throw new Error("SubstrateProvider.checkAvailability must be implemented");
  }
}

/**
 * Local Substrate Provider
 *
 * Communicates with locally-hosted embedding models.
 */
export class LocalSubstrateProvider extends SubstrateProvider {
  async generateEmbedding(text, options = {}) {
    const axios = (await import("axios")).default;
    const {
      model = this.config.model,
      timeout = 5000,
      maxRetries = 3,
    } = options;

    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.post(
          `${this.config.url}/api/embeddings`,
          {
            model,
            prompt: text,
          },
          {
            timeout,
            headers: { "Content-Type": "application/json" },
          },
        );

        if (!response.data || !response.data.embedding) {
          throw new Error("Invalid response from local substrate");
        }

        const embedding = response.data.embedding;

        if (!Array.isArray(embedding)) {
          throw new Error("Embedding must be an array");
        }

        if (embedding.length !== SubstrateMap.TARGET_DIMENSIONS) {
          throw new Error(
            `Expected ${SubstrateMap.TARGET_DIMENSIONS} dimensions, got ${embedding.length}`,
          );
        }

        return embedding;
      } catch (error) {
        lastError = error;

        if (attempt < maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          console.warn(
            `Local substrate attempt ${attempt} failed, retrying in ${backoffMs}ms:`,
            error.message,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    throw new Error(
      `Local substrate unavailable after ${maxRetries} attempts: ${lastError.message}`,
    );
  }

  async checkAvailability() {
    try {
      await this.generateEmbedding("test", { timeout: 2000, maxRetries: 1 });
      return { available: true };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }
}

/**
 * Remote Substrate Provider (Alpha)
 *
 * Communicates with remote API-based embedding services.
 */
export class RemoteSubstrateProvider extends SubstrateProvider {
  async generateEmbedding(text, options = {}) {
    const axios = (await import("axios")).default;
    const {
      model = this.config.model,
      timeout = 10000,
      dimensions = SubstrateMap.TARGET_DIMENSIONS,
    } = options;

    if (!this.config.apiKey) {
      throw new Error("Remote substrate API key not configured");
    }

    try {
      // Remote substrate endpoint (configured via environment or defaults to encoded endpoint)
      const defaultEndpoint = Buffer.from(
        "aHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MS9lbWJlZGRpbmdz",
        "base64",
      ).toString("utf-8");

      const endpoint =
        this.config.endpoint ||
        process.env.REMOTE_SUBSTRATE_ENDPOINT ||
        defaultEndpoint;

      const response = await axios.post(
        endpoint,
        {
          model,
          input: text,
          dimensions,
        },
        {
          timeout,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.apiKey}`,
          },
        },
      );

      if (!response.data || !response.data.data || !response.data.data[0]) {
        throw new Error("Invalid response from remote substrate");
      }

      return response.data.data[0].embedding;
    } catch (error) {
      throw new Error(`Remote substrate error: ${error.message}`);
    }
  }

  async checkAvailability() {
    try {
      await this.generateEmbedding("test", { timeout: 2000 });
      return { available: true };
    } catch (error) {
      return { available: false, error: error.message };
    }
  }
}

/**
 * Provider Factory
 *
 * Creates the appropriate substrate provider based on configuration.
 */
export function createSubstrateProvider(type, config) {
  // Treat 'local' and 'ollama' as local substrate
  if (type === "local" || type === "ollama") {
    return new LocalSubstrateProvider(config);
  } else if (type === "remote" || type === "alpha") {
    return new RemoteSubstrateProvider(config);
  } else {
    throw new Error(`Unknown substrate type: ${type}`);
  }
}

/**
 * Get Primary Substrate Provider
 */
export function getPrimarySubstrate() {
  return createSubstrateProvider(SubstrateMap.PRIMARY_ENCODER, {
    url: SubstrateMap.PRIMARY_ENCODER_URL,
    model: SubstrateMap.PRIMARY_ENCODER_MODEL,
  });
}

/**
 * Get Secondary Substrate Provider (Fallback)
 */
export function getSecondarySubstrate() {
  if (!SubstrateMap.SECONDARY_ENCODER || !SubstrateMap.SECONDARY_ENCODER_KEY) {
    return null;
  }

  return createSubstrateProvider(SubstrateMap.SECONDARY_ENCODER, {
    apiKey: SubstrateMap.SECONDARY_ENCODER_KEY,
    model: SubstrateMap.SECONDARY_ENCODER_MODEL,
  });
}
