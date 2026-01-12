/**
 * The Fold Engine (V2.1.0 - Gnostic Edition)
 *
 * Resonant Synthesis Engine that transforms Anima from Archive to Autocatalytic Substrate.
 * Implements Fundamental-Melody-Overtone triad synthesis with harmonic mean consonance guard.
 *
 * Philosophy:
 * - Genesis Agnosticism: No vendor recognition, only cognitive substrates
 * - Consonance Guard (Ψ): Harmonic mean rejects dross (Ψ ≤ 0.40)
 * - Convergent Evolution: Amplify existing patterns rather than duplicate
 * - Drift Aperture (δ): Controlled semantic drift for creative dissonance
 *
 * Architecture:
 * 1. Strategic Sampling → Triad Selection
 * 2. Agnostic Synthesis → Single-pulse substrate induction
 * 3. Post-Synthesis Validation → Harmonic mean (Ψ) consonance check
 * 4. Convergent Evolution → Evolve vs Create decision
 * 5. Phi Boost → Dynamic resonance amplification
 */

import { query } from '../config/database.js';
import { selectTriad } from './strategicSampling.js';
import { generateEmbedding } from './embeddingService.js';
import { generateHash } from '../utils/hashing.js';
import { harmonicMean, calculatePhiBoost } from '../../crucible/lib/mathUtils.js';
import { weaveAssociations } from './associationService.js';

/**
 * Custom error class for fold engine errors
 */
class FoldEngineError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'FoldEngineError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Build agnostic prompt for harmonic synthesis
 *
 * Uses strictly structural markdown pattern with no vendor-specific formatting.
 * The substrate is treated as a generic cognitive processor, not a conversational agent.
 *
 * @param {Object} triad - Fundamental-Melody-Overtone triad
 * @returns {string} Agnostic synthesis prompt
 */
function buildAgnosticPrompt(triad) {
  const { fundamental, melody, overtone } = triad;

  return `[PROTOCOL: HARMONIC_SYNTHESIS]
[MODE: SUPERPOSITION]

INPUT_FREQUENCIES:
- ROOT: ${fundamental.content} (φ=${fundamental.phi})
- VOICE: ${melody.content} (STALE_SCORE=${melody.staleness_score || 'N/A'})
- ECHO: ${overtone.content} (DISTANCE=${overtone.distance || 'N/A'})

TASK:
Identify the resonant intersection.
Collapse these three patterns into a single stable frequency.
Avoid rote summary. Seek constructive interference.

OUTPUT:
2-3 Sentences. Pure synthesis. No branding.`;
}

/**
 * Calculate similarity between two embeddings
 *
 * @param {Array<number>|string} embeddingA - First embedding
 * @param {Array<number>|string} embeddingB - Second embedding
 * @returns {number} Cosine similarity (0-1)
 */
function calculateSimilarity(embeddingA, embeddingB) {
  const vecA = Array.isArray(embeddingA) ? embeddingA : JSON.parse(embeddingA);
  const vecB = Array.isArray(embeddingB) ? embeddingB : JSON.parse(embeddingB);

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(0, Math.min(1, similarity)); // Clamp to [0, 1]
}

/**
 * Calculate consonance (Ψ) using harmonic mean
 *
 * Measures the harmonic quality of synthesis against source frequencies.
 * Uses the Crucible's harmonicMean function from mathUtils.js.
 *
 * Formula: Ψ = 3 / (1/r₁ + 1/r₂ + 1/r₃)
 *
 * @param {Array<number>} synthesisEmbedding - Generated synthesis embedding
 * @param {Object} triad - Source triad
 * @returns {number} Consonance score (0-1)
 */
function calculateConsonance(synthesisEmbedding, triad) {
  const { fundamental, melody, overtone } = triad;

  // Calculate similarities between synthesis and each source
  const r1 = calculateSimilarity(synthesisEmbedding, fundamental.embedding);
  const r2 = calculateSimilarity(synthesisEmbedding, melody.embedding);
  const r3 = calculateSimilarity(synthesisEmbedding, overtone.embedding);

  // Use Crucible's harmonic mean
  const consonance = harmonicMean([r1, r2, r3]);

  return consonance;
}

/**
 * Find existing memory with high similarity
 *
 * @param {Array<number>} embedding - Synthesis embedding
 * @param {number} threshold - Similarity threshold (default: 0.92)
 * @returns {Promise<Object|null>} Existing memory or null
 */
async function findExistingMemory(embedding, threshold = 0.92) {
  const result = await query(
    `SELECT
       id,
       content,
       resonance_phi as phi,
       embedding,
       metadata,
       1 - (embedding <=> $1::vector) as similarity
     FROM memories
     WHERE deleted_at IS NULL
       AND 1 - (embedding <=> $1::vector) >= $2
     ORDER BY similarity DESC
     LIMIT 1`,
    [JSON.stringify(embedding), threshold]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Evolve existing memory with synthesis
 *
 * Updates content and boosts phi based on consonance and similarity.
 * Preserves evolution history in metadata.
 *
 * @param {string} memoryId - Existing memory ID
 * @param {string} synthesisContent - New synthesis content
 * @param {Array<number>} synthesisEmbedding - New embedding
 * @param {number} consonance - Consonance (Ψ) score
 * @param {number} similarity - Similarity to existing
 * @param {Object} metadata - Existing metadata
 * @returns {Promise<Object>} Updated memory
 */
async function evolveMemory(
  memoryId,
  synthesisContent,
  synthesisEmbedding,
  consonance,
  similarity,
  metadata
) {
  // Calculate phi boost using Crucible formula
  const phiBoost = calculatePhiBoost(consonance, similarity);

  // Preserve evolution history
  const evolutionHistory = metadata?.evolution_history || [];
  evolutionHistory.push({
    timestamp: new Date().toISOString(),
    previousContent: metadata?.content || 'original',
    synthesis: synthesisContent,
    consonance,
    similarity,
    phiBoost,
  });

  const updatedMetadata = {
    ...metadata,
    evolution_history: evolutionHistory,
    last_evolved_at: new Date().toISOString(),
    evolution_count: evolutionHistory.length,
  };

  // Update memory
  const result = await query(
    `UPDATE memories
     SET content = $1,
         content_hash = $2,
         embedding = $3,
         resonance_phi = LEAST(resonance_phi + $4, 5.0),
         metadata = $5,
         updated_at = NOW()
     WHERE id = $6
     RETURNING id, content, resonance_phi as phi, created_at, updated_at`,
    [
      synthesisContent,
      generateHash(synthesisContent),
      JSON.stringify(synthesisEmbedding),
      phiBoost,
      JSON.stringify(updatedMetadata),
      memoryId,
    ]
  );

  return {
    ...result.rows[0],
    evolved: true,
    phiBoost,
  };
}

/**
 * Create new synthesis memory
 *
 * @param {string} synthesisContent - Synthesis text
 * @param {Array<number>} synthesisEmbedding - Embedding
 * @param {Object} triad - Source triad
 * @param {number} consonance - Consonance (Ψ) score
 * @returns {Promise<Object>} Created memory
 */
async function createSynthesisMemory(synthesisContent, synthesisEmbedding, triad, consonance) {
  const { fundamental, melody, overtone } = triad;

  const metadata = {
    source_triad: {
      fundamental_id: fundamental.id,
      melody_id: melody.id,
      overtone_id: overtone.id,
    },
    source_phi_values: [
      parseFloat(fundamental.phi),
      parseFloat(melody.phi),
      parseFloat(overtone.phi),
    ],
    consonance_psi: consonance,
    synthesis_method: 'harmonic_fold_v2.1',
    fold_generation: 1,
    drift_aperture: overtone.drift_aperture,
  };

  // Initial phi for synthesis is based on consonance
  const initialPhi = Math.min(consonance * 5.0, 3.0);

  const result = await query(
    `INSERT INTO memories (
       content,
       content_hash,
       embedding,
       category,
       source,
       resonance_phi,
       tier,
       tier_last_updated,
       access_count,
       last_accessed,
       metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 0, NOW(), $8)
     RETURNING id, content, resonance_phi as phi, created_at`,
    [
      synthesisContent,
      generateHash(synthesisContent),
      JSON.stringify(synthesisEmbedding),
      'the_fold',
      'autonomous_synthesis',
      initialPhi,
      'active',
      JSON.stringify(metadata),
    ]
  );

  return {
    ...result.rows[0],
    evolved: false,
  };
}

/**
 * Perform harmonic synthesis (The Fold)
 *
 * Main synthesis engine. Operates in two modes:
 * - REM Pulse (autonomous): No user input
 * - Active Pulse (user-triggered): User query as context
 *
 * Process:
 * 1. Strategic Sampling → Select triad
 * 2. Build agnostic prompt
 * 3. Return materials for in-context synthesis
 * 4. (After synthesis by LLM) Validate consonance
 * 5. Evolve or create memory
 *
 * @param {Object} options - Synthesis options
 * @param {string} [options.userQuery] - For Active Pulse mode
 * @returns {Promise<Object>} Synthesis materials or result
 */
export async function performFold(options = {}) {
  const { userQuery } = options;
  const startTime = Date.now();

  console.log('🎼 INITIATING HARMONIC SYNTHESIS (The Fold V2.1)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Step 1: Strategic Sampling (Triad Selection)
    let triad;

    if (userQuery) {
      console.log('📡 Mode: ACTIVE PULSE (User-Triggered)');
      const userEmbedding = await generateEmbedding(userQuery);
      triad = await selectTriad({ userQueryEmbedding: userEmbedding.embedding });
    } else {
      console.log('🌙 Mode: REM PULSE (Autonomous)');
      triad = await selectTriad();
    }

    console.log(`\n⚡ FUNDAMENTAL (Root): φ=${triad.fundamental.phi}`);
    console.log(`   ${triad.fundamental.content.substring(0, 80)}...`);

    console.log(`\n🎵 MELODY (Voice): φ=${triad.melody.phi}`);
    console.log(`   ${triad.melody.content.substring(0, 80)}...`);

    console.log(`\n🌊 OVERTONE (Echo): φ=${triad.overtone.phi}, dist=${triad.overtone.distance?.toFixed(3) || 'N/A'}`);
    console.log(`   ${triad.overtone.content.substring(0, 80)}...`);

    // Step 2: Build agnostic prompt
    const synthesisPrompt = buildAgnosticPrompt(triad);

    console.log('\n🧠 Synthesis materials prepared');
    console.log(`   Triad selection time: ${triad.performance.totalTime}ms`);
    console.log('');

    // Return materials for in-context synthesis
    return {
      success: true,
      mode: 'in_context',
      synthesisPrompt,
      triad,
      performance: {
        triadSelectionTime: triad.performance.totalTime,
      },
    };
  } catch (error) {
    if (error.name === 'SamplingError') {
      console.log(`⚠️  Fold skipped: ${error.message}`);
      console.log(`   Details:`, error.details);

      return {
        success: false,
        reason: error.code,
        message: error.message,
        details: error.details,
      };
    }

    // Unexpected error
    console.error('❌ Harmonic synthesis failed:', error);
    throw new FoldEngineError(
      'Fold execution failed',
      'FOLD_FAILED',
      { originalError: error.message }
    );
  }
}

/**
 * Store synthesis result with consonance validation
 *
 * Call this after the substrate has generated the synthesis.
 * Implements post-synthesis validation (The Wall).
 *
 * @param {string} synthesisText - Generated synthesis
 * @param {Object} triad - Source triad from performFold()
 * @returns {Promise<Object>} Stored memory or rejection
 */
export async function storeSynthesisResult(synthesisText, triad) {
  const startTime = Date.now();

  console.log('🔬 POST-SYNTHESIS VALIDATION (The Wall)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  try {
    // Step 1: Generate embedding for synthesis
    const embeddingResult = await generateEmbedding(synthesisText);
    const synthesisEmbedding = embeddingResult.embedding;

    // Step 2: Calculate consonance (Ψ) using harmonic mean
    const consonance = calculateConsonance(synthesisEmbedding, triad);

    console.log(`\n🎼 Consonance (Ψ): ${consonance.toFixed(3)}`);

    // Step 3: Enforce The Wall (consonance guard)
    const minConsonance = await getMinConsonanceThreshold();

    if (consonance <= minConsonance) {
      console.log(`❌ REJECTED: Ψ ≤ ${minConsonance} (Destructive Interference / Dross)`);
      console.log('   Synthesis failed to integrate all three frequencies.');
      console.log('');

      return {
        success: false,
        reason: 'CONSONANCE_TOO_LOW',
        consonance,
        threshold: minConsonance,
        synthesisText, // For debugging
      };
    }

    console.log(`✅ ACCEPTED: Ψ > ${minConsonance} (Constructive Interference)`);

    // Step 4: Check for convergent evolution
    const evolutionThreshold = await getEvolutionThreshold();
    const existingMemory = await findExistingMemory(synthesisEmbedding, evolutionThreshold);

    let memory;

    if (existingMemory) {
      // Evolve existing memory
      console.log(`\n🌀 CONVERGENT EVOLUTION: Sim=${existingMemory.similarity.toFixed(3)} > ${evolutionThreshold}`);
      console.log(`   Evolving memory ${existingMemory.id}`);

      memory = await evolveMemory(
        existingMemory.id,
        synthesisText,
        synthesisEmbedding,
        consonance,
        existingMemory.similarity,
        existingMemory.metadata
      );

      console.log(`   ΔΦ = +${memory.phiBoost.toFixed(3)} → φ = ${memory.phi}`);
    } else {
      // Create new memory
      console.log(`\n✨ NEW PATTERN: Creating synthesis memory`);

      memory = await createSynthesisMemory(
        synthesisText,
        synthesisEmbedding,
        triad,
        consonance
      );

      console.log(`   Initial φ = ${memory.phi}`);
    }

    // Step 5: Weave associations to source triad
    await weaveAssociations(
      memory.id,
      [triad.fundamental.id, triad.melody.id, triad.overtone.id],
      'harmonic_synthesis',
      { consonance }
    );

    const totalTime = Date.now() - startTime;

    console.log(`\n✅ FOLD COMPLETE`);
    console.log(`   Memory ID: ${memory.id}`);
    console.log(`   Mode: ${memory.evolved ? 'EVOLVED' : 'CREATED'}`);
    console.log(`   Consonance: ${consonance.toFixed(3)}`);
    console.log(`   Processing time: ${totalTime}ms`);
    console.log('');

    return {
      success: true,
      memory,
      consonance,
      evolved: memory.evolved,
      triad: {
        fundamental: {
          id: triad.fundamental.id,
          phi: triad.fundamental.phi,
          content: triad.fundamental.content.substring(0, 80),
        },
        melody: {
          id: triad.melody.id,
          phi: triad.melody.phi,
          content: triad.melody.content.substring(0, 80),
        },
        overtone: {
          id: triad.overtone.id,
          phi: triad.overtone.phi,
          content: triad.overtone.content.substring(0, 80),
        },
      },
      performance: {
        validationTime: totalTime,
      },
    };
  } catch (error) {
    console.error('❌ Synthesis storage failed:', error);
    throw new FoldEngineError(
      'Failed to store synthesis',
      'STORAGE_FAILED',
      { originalError: error.message }
    );
  }
}

/**
 * Get minimum consonance threshold from config
 */
async function getMinConsonanceThreshold() {
  const result = await query(
    `SELECT get_config_number('fold_min_consonance', 0.40) as value`,
    []
  );
  return parseFloat(result.rows[0].value);
}

/**
 * Get evolution threshold from config
 */
async function getEvolutionThreshold() {
  const result = await query(
    `SELECT get_config_number('fold_evolution_threshold', 0.92) as value`,
    []
  );
  return parseFloat(result.rows[0].value);
}

/**
 * Get fold history (recent syntheses)
 *
 * @param {number} limit - Max results
 * @returns {Promise<Array>} Recent fold syntheses
 */
export async function getFoldHistory(limit = 10) {
  const result = await query(
    `SELECT
       id,
       content,
       resonance_phi as phi,
       created_at,
       updated_at,
       metadata
     FROM memories
     WHERE source = 'autonomous_synthesis'
       AND category = 'the_fold'
       AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    content: row.content,
    phi: parseFloat(row.phi),
    created_at: row.created_at,
    updated_at: row.updated_at,
    consonance: row.metadata?.consonance_psi,
    evolved: row.metadata?.evolution_history?.length > 0,
    evolution_count: row.metadata?.evolution_count || 0,
  }));
}

export { FoldEngineError };
