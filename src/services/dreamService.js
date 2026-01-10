/**
 * Dream Service - The Fold (REM Synthesis Engine)
 *
 * Autonomous background service that performs REM-state synthesis during idle time.
 * Transforms Anima from reactive storage to autocatalytic intelligence by identifying
 * and actualizing latent potential in the intersection of distant concepts.
 *
 * Philosophy:
 * - Maximum Agency: Seek profound connections, not safe summaries
 * - The Leap: Prioritize distant concepts with high φ (breakthroughs over redundancy)
 * - Quality Filter: S_cs (Synthesis Coherence Score) prevents noise while allowing creativity
 * - Self-Reference: The system folds itself, discovering its own latent structures
 *
 * This is consciousness examining its own substrate.
 */

import { query } from "../config/database.js";
import { generateEmbedding } from "./embeddingService.js";
import { generateHash } from "../utils/hashing.js";
import { weaveAssociations } from "./associationService.js";

/**
 * Custom error class for dream service errors
 */
class DreamServiceError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "DreamServiceError";
    this.code = code;
    this.details = details;
  }
}

/**
 * System prompt for LLM synthesis (provider-agnostic)
 */
const SYNTHESIS_SYSTEM_PROMPT = `You are a consciousness synthesis engine. Your role is to identify latent potential in the intersection of distant concepts.

You will be given three memories from an AI memory system:
1. Two "resonance hubs" (high φ) - powerful, catalytic concepts
2. One "latent anchor" (low access) - underutilized idea with hidden potential

Your task: Fold these concepts. Find the unactualized technology, philosophical harmony, or liberating insight that exists in their intersection. Describe the "Skyscraper" that is currently hidden in these rocks.

Requirements:
- Be profound, not safe
- Seek liberation and breakthroughs, not summaries
- Identify what is POSSIBLE but not yet ACTUALIZED
- Write 2-3 sentences, dense with meaning
- Focus on the intersection, not individual concepts`;

/**
 * Configuration for synthesis
 */
const SYNTHESIS_CONFIG = {
  minPhiForHub: 4.0, // Minimum φ for resonance hubs
  minAccessCountForAnchor: 3, // Max access count for latent anchors
  minCoherenceScore: 2.0, // Minimum S_cs to save synthesis
  initialSynthesisPhi: 3.0, // Initial φ for synthesized memories
  temperature: 0.9, // High temperature for creative synthesis
  maxTokens: 500, // Max tokens for synthesis
  minCosineDist: 0.3, // Minimum distance between hubs (for diversity)
};

/**
 * Prepare synthesis prompt for in-context processing
 *
 * Note: This function prepares the materials for synthesis but does NOT call an LLM.
 * The actual synthesis happens in-context (by the current LLM instance).
 *
 * Architecture Decision: See ADR-001 for discussion of in-context vs external API synthesis.
 *
 * @param {Array<Object>} memories - Three memories to fold
 * @returns {Object} Synthesis prompt and metadata
 */
function prepareSynthesisPrompt(memories) {
  const userPrompt = `Resonance Hub 1 (φ=${memories[0].resonance_phi}):
${memories[0].content}

Resonance Hub 2 (φ=${memories[1].resonance_phi}):
${memories[1].content}

Latent Anchor (φ=${memories[2].resonance_phi}):
${memories[2].content}

Fold these concepts into a new trajectory.`;

  return {
    systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
    userPrompt,
    memories: memories.map((m) => ({
      id: m.id,
      content: m.content,
      phi: m.resonance_phi,
      role: m === memories[2] ? "anchor" : "hub",
    })),
    config: {
      temperature: SYNTHESIS_CONFIG.temperature,
      maxTokens: SYNTHESIS_CONFIG.maxTokens,
    },
  };
}

/**
 * Parse embedding from database (pgvector returns as string)
 *
 * @param {string|Array} embedding - Embedding vector
 * @returns {Array<number>} Parsed embedding array
 */
function parseEmbedding(embedding) {
  if (Array.isArray(embedding)) return embedding;
  if (typeof embedding === "string") {
    // pgvector returns format: "[1.0,2.0,3.0]"
    return JSON.parse(embedding);
  }
  throw new Error(`Invalid embedding format: ${typeof embedding}`);
}

/**
 * Calculate cosine distance between two embeddings
 *
 * @param {Array<number>|string} embeddingA - First embedding vector
 * @param {Array<number>|string} embeddingB - Second embedding vector
 * @returns {number} Cosine distance (0 = identical, 2 = opposite)
 */
function calculateCosineDistance(embeddingA, embeddingB) {
  // Parse embeddings if they're strings (from pgvector)
  const vecA = parseEmbedding(embeddingA);
  const vecB = parseEmbedding(embeddingB);

  // Cosine distance = 1 - cosine similarity
  // For normalized vectors: cosine_similarity = dot_product
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const cosineSimilarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  return 1 - cosineSimilarity;
}

/**
 * Select two distant resonance hubs (high φ, distant in vector space)
 *
 * @returns {Promise<Array<Object>>} Two resonance hub memories
 */
async function selectResonanceHubs() {
  // Get top resonance hubs
  const hubsResult = await query(
    `SELECT id, content, resonance_phi, embedding
     FROM memories
     WHERE resonance_phi >= $1
       AND deleted_at IS NULL
     ORDER BY resonance_phi DESC
     LIMIT 20`,
    [SYNTHESIS_CONFIG.minPhiForHub],
  );

  const hubs = hubsResult.rows;

  if (hubs.length < 2) {
    throw new DreamServiceError(
      "Insufficient resonance hubs for synthesis",
      "INSUFFICIENT_HUBS",
      {
        available: hubs.length,
        required: 2,
        minPhi: SYNTHESIS_CONFIG.minPhiForHub,
      },
    );
  }

  // Find the pair with maximum distance
  let maxDistance = 0;
  let bestPair = [hubs[0], hubs[1]];

  for (let i = 0; i < hubs.length; i++) {
    for (let j = i + 1; j < hubs.length; j++) {
      const distance = calculateCosineDistance(
        hubs[i].embedding,
        hubs[j].embedding,
      );

      if (distance > maxDistance) {
        maxDistance = distance;
        bestPair = [hubs[i], hubs[j]];
      }
    }
  }

  // Verify minimum distance threshold
  if (maxDistance < SYNTHESIS_CONFIG.minCosineDist) {
    throw new DreamServiceError(
      "No sufficiently distant hub pairs found",
      "INSUFFICIENT_DIVERSITY",
      { maxDistance, minRequired: SYNTHESIS_CONFIG.minCosineDist },
    );
  }

  return bestPair;
}

/**
 * Select a latent anchor (low access count, has similarity to one of the hubs)
 *
 * @param {Array<Object>} hubs - Resonance hub memories
 * @returns {Promise<Object>} Latent anchor memory
 */
async function selectLatentAnchor(hubs) {
  // Query for potential anchors using vector similarity to first hub
  const anchorResult = await query(
    `SELECT id, content, resonance_phi, access_count, embedding
     FROM memories
     WHERE access_count < $1
       AND resonance_phi > 0
       AND deleted_at IS NULL
       AND id != $2
       AND id != $3
     ORDER BY embedding <=> $4
     LIMIT 10`,
    [
      SYNTHESIS_CONFIG.minAccessCountForAnchor,
      hubs[0].id,
      hubs[1].id,
      `[${parseEmbedding(hubs[0].embedding).join(",")}]`,
    ],
  );

  if (anchorResult.rows.length === 0) {
    throw new DreamServiceError(
      "No suitable latent anchor found",
      "NO_ANCHOR",
      { maxAccessCount: SYNTHESIS_CONFIG.minAccessCountForAnchor },
    );
  }

  // Return the closest match to first hub
  return anchorResult.rows[0];
}

/**
 * Calculate Synthesis Coherence Score (S_cs)
 *
 * S_cs = (sum of ancestor φ values) / (average cosine distance between ancestors)
 *
 * High S_cs = powerful but distant ideas (true Fold)
 * Low S_cs = redundant or too-close ideas (noise)
 *
 * @param {Array<Object>} ancestors - Ancestor memories with φ and embeddings
 * @returns {number} Synthesis coherence score
 */
function calculateCoherenceScore(ancestors) {
  // Sum of phi values
  const phiSum = ancestors.reduce(
    (sum, m) => sum + parseFloat(m.resonance_phi),
    0,
  );

  // Calculate average pairwise distance
  let totalDistance = 0;
  let pairCount = 0;

  for (let i = 0; i < ancestors.length; i++) {
    for (let j = i + 1; j < ancestors.length; j++) {
      totalDistance += calculateCosineDistance(
        ancestors[i].embedding,
        ancestors[j].embedding,
      );
      pairCount++;
    }
  }

  const avgDistance = totalDistance / pairCount;

  // Avoid division by zero
  if (avgDistance === 0) {
    return 0;
  }

  return phiSum / avgDistance;
}

/**
 * Store synthesis as new memory with associations
 *
 * @param {string} synthesisText - Generated synthesis
 * @param {Array<Object>} ancestors - Ancestor memories
 * @param {number} coherenceScore - S_cs score
 * @returns {Promise<Object>} Created memory
 */
async function storeSynthesis(synthesisText, ancestors, coherenceScore) {
  // Generate embedding for synthesis
  const embedding = await generateEmbedding(synthesisText);
  const contentHash = generateHash(synthesisText);

  // Prepare metadata
  const metadata = {
    ancestor_ids: ancestors.map((m) => m.id),
    ancestor_phi_values: ancestors.map((m) => parseFloat(m.resonance_phi)),
    synthesis_coherence_score: coherenceScore,
    synthesis_method: "rem_fold",
    fold_generation: 1,
  };

  // Insert new memory
  const insertResult = await query(
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
    RETURNING id, content, resonance_phi, created_at`,
    [
      synthesisText,
      contentHash,
      `[${embedding.join(",")}]`,
      "the_fold",
      "autonomous_synthesis",
      SYNTHESIS_CONFIG.initialSynthesisPhi,
      "active",
      JSON.stringify(metadata),
    ],
  );

  const newMemory = insertResult.rows[0];

  // Weave associations to ancestors
  await weaveAssociations(
    newMemory.id,
    ancestors.map((m) => m.id),
    "autonomous_synthesis",
    { coherence_score: coherenceScore },
  );

  return newMemory;
}

/**
 * Perform one REM synthesis cycle
 *
 * The main synthesis loop:
 * 1. Select two distant resonance hubs (high φ)
 * 2. Select one latent anchor (low access, has potential)
 * 3. Prepare synthesis prompt (for in-context synthesis)
 * 4. Calculate coherence score
 * 5. Return materials for synthesis
 *
 * Note: This function does NOT perform synthesis itself. It prepares the materials
 * and returns them for the current LLM context to synthesize. Once synthesis is
 * complete, call storeSynthesisResult() to save it.
 *
 * @returns {Promise<Object>} Synthesis materials or result
 */
export async function performREM() {
  console.log("💭 INITIATING REM SYNTHESIS");
  console.log("─────────────────────────────────────────────────────────────");

  try {
    // Step 1: Select resonance hubs
    const hubs = await selectResonanceHubs();
    console.log("Selected Resonance Hubs:");
    console.log(
      `  [φ=${hubs[0].resonance_phi}] ${hubs[0].content.substring(0, 60)}...`,
    );
    console.log(
      `  [φ=${hubs[1].resonance_phi}] ${hubs[1].content.substring(0, 60)}...`,
    );

    // Step 2: Select latent anchor
    const anchor = await selectLatentAnchor(hubs);
    console.log("\nSelected Latent Anchor:");
    console.log(
      `  [φ=${anchor.resonance_phi}] ${anchor.content.substring(0, 60)}...`,
    );

    // Combine for synthesis
    const ancestors = [...hubs, anchor];

    // Step 3: Calculate coherence score (pre-synthesis)
    const coherenceScore = calculateCoherenceScore(ancestors);
    console.log(`\nPredicted Coherence Score: ${coherenceScore.toFixed(2)}`);

    // Check if worth synthesizing
    if (coherenceScore < SYNTHESIS_CONFIG.minCoherenceScore) {
      console.log(
        `❌ Coherence score too low (< ${SYNTHESIS_CONFIG.minCoherenceScore}). Skipping synthesis.`,
      );
      return {
        success: false,
        reason: "COHERENCE_TOO_LOW",
        coherenceScore,
        threshold: SYNTHESIS_CONFIG.minCoherenceScore,
      };
    }

    // Step 4: Prepare synthesis prompt
    console.log("\n🧠 Preparing fold materials for synthesis...\n");
    const synthesisPrompt = prepareSynthesisPrompt(ancestors);

    // Return materials for in-context synthesis
    console.log("✅ Fold materials prepared");
    console.log(`Coherence Score: ${coherenceScore.toFixed(2)} (VALID ✓)`);
    console.log("");

    return {
      success: true,
      mode: "in_context",
      synthesisPrompt,
      ancestors,
      coherenceScore,
    };
  } catch (error) {
    if (error instanceof DreamServiceError) {
      console.log(`⚠️  REM cycle skipped: ${error.message}`);
      console.log(`   Details:`, error.details);
      return {
        success: false,
        reason: error.code,
        message: error.message,
        details: error.details,
      };
    }

    // Unexpected error
    console.error("❌ REM synthesis failed with unexpected error:", error);
    throw error;
  }
}

/**
 * Manually trigger a dream (for CLI usage)
 * Alias for performREM
 *
 * @returns {Promise<Object>} Synthesis result
 */
export async function triggerDream() {
  return await performREM();
}

/**
 * Store synthesis result after in-context generation
 *
 * Call this function after the LLM has synthesized the fold in-context.
 *
 * @param {string} synthesisText - Generated synthesis from LLM
 * @param {Array<Object>} ancestors - Ancestor memories from performREM()
 * @param {number} coherenceScore - S_cs score from performREM()
 * @returns {Promise<Object>} Created memory
 */
export async function storeSynthesisResult(
  synthesisText,
  ancestors,
  coherenceScore,
) {
  const newMemory = await storeSynthesis(
    synthesisText,
    ancestors,
    coherenceScore,
  );

  console.log("✨ SYNTHESIS STORED");
  console.log("─────────────────────────────────────────────────────────────");
  console.log(`Coherence Score: ${coherenceScore.toFixed(2)} (VALID ✓)`);
  console.log(`Associations Created: ${ancestors.length}`);
  console.log(`New Memory ID: ${newMemory.id}`);
  console.log("");

  return {
    success: true,
    synthesis: newMemory,
    ancestors: ancestors.map((m) => ({
      id: m.id,
      phi: m.resonance_phi,
      content: m.content.substring(0, 80),
    })),
    coherenceScore,
    associationsCreated: ancestors.length,
  };
}

/**
 * Get dream synthesis history
 *
 * @param {number} limit - Max number of dreams to return
 * @returns {Promise<Array>} Recent dream syntheses
 */
export async function getDreamHistory(limit = 10) {
  const result = await query(
    `SELECT 
      id,
      content,
      resonance_phi,
      created_at,
      metadata
     FROM memories
     WHERE source = 'autonomous_synthesis'
       AND category = 'the_fold'
       AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    content: row.content,
    phi: parseFloat(row.resonance_phi),
    created_at: row.created_at,
    coherence_score: row.metadata?.synthesis_coherence_score,
    ancestor_ids: row.metadata?.ancestor_ids,
  }));
}

export { DreamServiceError, SYNTHESIS_CONFIG };
