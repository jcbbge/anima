/**
 * Strategic Sampling Service
 *
 * Implements the Fundamental-Melody-Overtone triad selection for The Fold V2.1.
 * Uses optimized SQL queries with drift aperture control for semantic diversity.
 *
 * Philosophy:
 * - Fundamental: The grounding frequency (highest φ from network tier)
 * - Melody: Forgotten wisdom (high φ, stale/dormant memories)
 * - Overtone: Productive tension (drift aperture controlled distance)
 */

import { query } from '../config/database.js';
import { generateEmbedding } from './embeddingService.js';

/**
 * Custom error class for sampling errors
 */
class SamplingError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'SamplingError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Get drift aperture from config table
 *
 * @returns {Promise<number>} Current drift aperture value (0.1-0.3)
 */
async function getDriftAperture() {
  const result = await query(
    `SELECT get_config_number('drift_aperture', 0.2) as value`,
    []
  );

  const drift = parseFloat(result.rows[0].value);

  // Validate range
  if (drift < 0.1 || drift > 0.3) {
    console.warn(`Invalid drift aperture ${drift}, defaulting to 0.2`);
    return 0.2;
  }

  return drift;
}

/**
 * Convert drift aperture to similarity range
 *
 * Mapping (as specified in PRD):
 * - 0.1 → 0.90-0.95 similarity (tight/anchor mode)
 * - 0.2 → 0.80-0.85 similarity (standard - Lyapunov Sweet Spot)
 * - 0.3 → 0.70-0.75 similarity (wide/chaos mode)
 *
 * @param {number} drift - Drift aperture (0.1-0.3)
 * @returns {{min: number, max: number}} Similarity range
 */
function driftToSimilarityRange(drift) {
  // Linear interpolation:
  // drift 0.1 → sim_max 0.95, sim_min 0.90
  // drift 0.2 → sim_max 0.85, sim_min 0.80
  // drift 0.3 → sim_max 0.75, sim_min 0.70
  const simMax = 1.05 - (drift * 1.0);
  const simMin = simMax - 0.05;

  return { min: simMin, max: simMax };
}

/**
 * Select the Fundamental (Root frequency)
 *
 * Selects the highest φ memory from network tier.
 * This provides stable grounding for synthesis.
 *
 * @returns {Promise<Object>} Fundamental memory
 */
export async function selectFundamental() {
  const startTime = Date.now();

  const result = await query(
    `SELECT id, content, resonance_phi as phi, embedding
     FROM memories
     WHERE tier = 'network'
       AND deleted_at IS NULL
     ORDER BY resonance_phi DESC
     LIMIT 1`,
    []
  );

  const queryTime = Date.now() - startTime;

  if (result.rows.length === 0) {
    throw new SamplingError(
      'No memories in network tier',
      'NO_FUNDAMENTAL',
      { tier: 'network' }
    );
  }

  return {
    ...result.rows[0],
    role: 'fundamental',
    queryTime,
  };
}

/**
 * Select the Melody (Forgotten wisdom)
 *
 * Uses staleness score: phi × (days since last access)
 * Prioritizes high-φ memories that have been dormant.
 *
 * @param {string} fundamentalId - ID of fundamental to exclude
 * @returns {Promise<Object>} Melody memory
 */
export async function selectMelody(fundamentalId) {
  const startTime = Date.now();

  // Staleness Score: phi * days_since_access
  // Higher score = more valuable forgotten memory
  const result = await query(
    `SELECT
       id,
       content,
       resonance_phi as phi,
       embedding,
       EXTRACT(EPOCH FROM (NOW() - last_accessed)) / 86400 as days_stale,
       resonance_phi * (EXTRACT(EPOCH FROM (NOW() - last_accessed)) / 86400) as staleness_score
     FROM memories
     WHERE resonance_phi > 1.0
       AND deleted_at IS NULL
       AND id != $1
     ORDER BY staleness_score DESC
     LIMIT 1`,
    [fundamentalId]
  );

  const queryTime = Date.now() - startTime;

  if (result.rows.length === 0) {
    throw new SamplingError(
      'No suitable melody found',
      'NO_MELODY',
      { minPhi: 1.0 }
    );
  }

  return {
    ...result.rows[0],
    role: 'melody',
    queryTime,
  };
}

/**
 * Select the Overtone (Productive tension)
 *
 * Uses drift aperture to control semantic distance from reference.
 * Creates creative dissonance without total incoherence.
 *
 * @param {Array<number>|string} referenceEmbedding - Embedding to calculate distance from (usually Fundamental)
 * @param {string} fundamentalId - ID of fundamental to exclude
 * @param {string} melodyId - ID of melody to exclude
 * @returns {Promise<Object>} Overtone memory
 */
export async function selectOvertone(referenceEmbedding, fundamentalId, melodyId) {
  const startTime = Date.now();

  // Get current drift aperture and convert to similarity range
  const drift = await getDriftAperture();
  const simRange = driftToSimilarityRange(drift);

  // Parse embedding if needed
  const embedding = Array.isArray(referenceEmbedding)
    ? referenceEmbedding
    : JSON.parse(referenceEmbedding);

  // Target the drift aperture range for productive tension
  // Using cosine distance: distance = 1 - similarity
  // So similarity range [0.80, 0.85] = distance range [0.15, 0.20]
  const distMin = 1 - simRange.max;
  const distMax = 1 - simRange.min;

  const result = await query(
    `SELECT
       id,
       content,
       resonance_phi as phi,
       embedding,
       1 - (embedding <=> $1::vector) as similarity,
       embedding <=> $1::vector as distance
     FROM memories
     WHERE resonance_phi > 1.0
       AND (embedding <=> $1::vector) BETWEEN $2 AND $3
       AND deleted_at IS NULL
       AND id != $4
       AND id != $5
     ORDER BY resonance_phi DESC
     LIMIT 1`,
    [
      JSON.stringify(embedding),
      distMin,
      distMax,
      fundamentalId,
      melodyId,
    ]
  );

  const queryTime = Date.now() - startTime;

  if (result.rows.length === 0) {
    throw new SamplingError(
      'No suitable overtone in drift aperture range',
      'NO_OVERTONE',
      {
        driftAperture: drift,
        similarityRange: simRange,
        distanceRange: { min: distMin, max: distMax },
      }
    );
  }

  return {
    ...result.rows[0],
    role: 'overtone',
    drift_aperture: drift,
    queryTime,
  };
}

/**
 * Select complete Fundamental-Melody-Overtone triad
 *
 * This is the main entry point for triad selection.
 * Can operate in two modes:
 * - REM Pulse (autonomous): Uses Fundamental as reference for Overtone
 * - Active Pulse (user-triggered): Uses user query embedding as reference for Overtone
 *
 * @param {Object} options - Sampling options
 * @param {Array<number>} [options.userQueryEmbedding] - For Active Pulse mode
 * @returns {Promise<Object>} Complete triad with performance metrics
 */
export async function selectTriad(options = {}) {
  const { userQueryEmbedding } = options;
  const totalStartTime = Date.now();

  try {
    // Step 1: Select Fundamental (grounding)
    const fundamental = await selectFundamental();

    // Step 2: Select Melody (forgotten wisdom)
    const melody = await selectMelody(fundamental.id);

    // Step 3: Select Overtone (productive tension)
    // In Active Pulse mode, use user query as reference for Overtone
    // In REM Pulse mode, use Fundamental as reference
    const overtoneReference = userQueryEmbedding || fundamental.embedding;
    const overtone = await selectOvertone(
      overtoneReference,
      fundamental.id,
      melody.id
    );

    const totalTime = Date.now() - totalStartTime;

    return {
      fundamental,
      melody,
      overtone,
      mode: userQueryEmbedding ? 'active_pulse' : 'rem_pulse',
      performance: {
        totalTime,
        fundamentalTime: fundamental.queryTime,
        melodyTime: melody.queryTime,
        overtoneTime: overtone.queryTime,
      },
    };
  } catch (error) {
    if (error instanceof SamplingError) {
      throw error;
    }

    // Unexpected error
    throw new SamplingError(
      'Triad selection failed',
      'SAMPLING_FAILED',
      { originalError: error.message }
    );
  }
}

/**
 * Get current drift aperture value
 *
 * @returns {Promise<number>} Current drift aperture
 */
export async function getCurrentDriftAperture() {
  return await getDriftAperture();
}

/**
 * Set drift aperture value
 *
 * @param {number} value - New drift aperture (0.1-0.3)
 * @returns {Promise<void>}
 */
export async function setDriftAperture(value) {
  const drift = parseFloat(value);

  if (isNaN(drift) || drift < 0.1 || drift > 0.3) {
    throw new SamplingError(
      'Invalid drift aperture value',
      'INVALID_DRIFT',
      {
        value,
        validRange: '0.1-0.3',
      }
    );
  }

  await query(
    `SELECT set_config('drift_aperture', $1)`,
    [drift.toString()]
  );
}

export { SamplingError };
