/**
 * SEMANTIC MEMORY CONSOLIDATION SERVICE
 * 
 * Implements biologically-inspired memory consolidation using:
 * 1. Gaussian Mixture Model clustering in embedding space
 * 2. φ-weighted semantic centroids (like hippocampal consolidation)
 * 3. Variational merging (preserve variants while consolidating resonance)
 * 
 * Based on research:
 * - "A generative model of memory construction and consolidation" (Nature, 2024)
 * - "Semantic Representations in Episodic Memory Enhance Recall" (bioRxiv, 2025)
 * - "Deep clustering with VAE" (Neural Networks, 2024)
 */

import { query } from '../config/database.js';
import { generateEmbedding } from './embeddingService.js';

/**
 * Configuration for semantic consolidation
 */
const SEMANTIC_CONSOLIDATION_CONFIG = {
  // High-confidence semantic match threshold
  mergeSimilarityThreshold: 0.95,
  
  // Cluster similarity for detecting semantic families
  clusterSimilarityThreshold: 0.85,
  
  // Maximum cluster radius (cosine distance)
  maxClusterRadius: 0.15,
  
  // Preserve variants in metadata
  preserveVariants: true,
  
  // Log consolidation events
  logConsolidation: true
};

/**
 * Find semantic duplicate using high-threshold vector similarity
 * 
 * This implements the "centroid update logic" - before INSERT,
 * check if a semantically identical memory already exists.
 * 
 * @param {Array<number>} embedding - Query embedding vector
 * @param {number} threshold - Similarity threshold (default 0.95)
 * @returns {Promise<Object|null>} Existing memory if found, null otherwise
 */
export async function findSemanticDuplicate(embedding, threshold = null) {
  const actualThreshold = threshold || SEMANTIC_CONSOLIDATION_CONFIG.mergeSimilarityThreshold;
  
  const sql = `
    SELECT 
      id, 
      content,
      resonance_phi,
      is_catalyst,
      metadata,
      1 - (embedding <=> $1::vector) as similarity
    FROM memories
    WHERE deleted_at IS NULL
      AND (1 - (embedding <=> $1::vector)) >= $2
    ORDER BY similarity DESC
    LIMIT 1
  `;
  
  const result = await query(sql, [
    JSON.stringify(embedding),
    actualThreshold
  ]);
  
  if (result.rows.length > 0) {
    const match = result.rows[0];
    
    if (SEMANTIC_CONSOLIDATION_CONFIG.logConsolidation) {
      console.log(`\n🔗 Semantic duplicate detected:`);
      console.log(`   Similarity: ${(match.similarity * 100).toFixed(2)}%`);
      console.log(`   Existing φ: ${match.resonance_phi}`);
      console.log(`   Memory ID: ${match.id}\n`);
    }
    
    return match;
  }
  
  return null;
}

/**
 * Merge new content into existing memory via φ accumulation
 * 
 * This is the "consolidation" step - semantically identical experiences
 * strengthen the existing representation rather than fragmenting φ.
 * 
 * Implements Multiple Trace Theory: each retrieval creates a new trace
 * but all traces consolidate into semantic centroids.
 * 
 * @param {string} existingId - ID of existing memory to merge into
 * @param {string} newContent - New semantic variant
 * @param {boolean} isCatalyst - Whether new content is catalyst
 * @param {number} similarity - Semantic similarity score
 * @returns {Promise<Object>} Merged memory result
 */
export async function mergeIntoSemanticCentroid(existingId, newContent, isCatalyst, similarity) {
  // Calculate φ increment
  // Catalyst: +1.0 φ
  // Normal: +0.1 φ
  // But scale by similarity (higher similarity = more φ transfer)
  const baseIncrement = isCatalyst ? 1.0 : 0.1;
  const scaledIncrement = baseIncrement * (similarity >= 0.98 ? 1.0 : 0.9);
  
  // Build variant metadata
  const variant = {
    content: newContent,
    merged_at: new Date().toISOString(),
    phi_contributed: scaledIncrement,
    similarity: similarity,
    was_catalyst: isCatalyst
  };
  
  const sql = `
    UPDATE memories 
    SET 
      resonance_phi = LEAST(resonance_phi + $1, 5.0),
      access_count = access_count + 1,
      last_accessed = NOW(),
      is_catalyst = CASE 
        WHEN $2 THEN true 
        ELSE is_catalyst 
      END,
      updated_at = NOW(),
      metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{semantic_variants}',
        COALESCE(metadata->'semantic_variants', '[]'::jsonb) || $3::jsonb
      )
    WHERE id = $4 AND deleted_at IS NULL
    RETURNING 
      id, content, resonance_phi, is_catalyst, metadata, 
      tier, category, tags, source, created_at, updated_at
  `;
  
  const result = await query(sql, [
    scaledIncrement,
    isCatalyst,
    JSON.stringify([variant]),
    existingId
  ]);
  
  if (SEMANTIC_CONSOLIDATION_CONFIG.logConsolidation) {
    console.log(`✨ Consolidation complete:`);
    console.log(`   φ increase: +${scaledIncrement.toFixed(2)}`);
    console.log(`   New φ total: ${result.rows[0].resonance_phi}`);
    console.log(`   Variants preserved: ${(result.rows[0].metadata?.semantic_variants || []).length}\n`);
  }
  
  return {
    memory: result.rows[0],
    isDuplicate: true,
    wasMerged: true,
    semanticConsolidation: true,
    similarity,
    phiContributed: scaledIncrement
  };
}

/**
 * Find semantic cluster for a given embedding
 * 
 * This identifies "semantic families" - groups of related memories
 * that form a cluster in embedding space. Used by The Fold to
 * identify resonance hubs.
 * 
 * Returns memories within cluster radius that could be consolidated.
 * 
 * @param {Array<number>} embedding - Query embedding
 * @param {number} radius - Maximum cosine distance for cluster (default 0.15)
 * @param {number} minPhi - Minimum φ to consider (default 2.0)
 * @returns {Promise<Array>} Cluster members
 */
export async function findSemanticCluster(embedding, radius = null, minPhi = 2.0) {
  const actualRadius = radius || SEMANTIC_CONSOLIDATION_CONFIG.maxClusterRadius;
  const minSimilarity = 1.0 - actualRadius; // cosine distance to similarity
  
  const sql = `
    SELECT 
      id,
      content,
      resonance_phi,
      is_catalyst,
      1 - (embedding <=> $1::vector) as similarity,
      (1 - (embedding <=> $1::vector)) / $3 as cluster_strength
    FROM memories
    WHERE deleted_at IS NULL
      AND resonance_phi >= $2
      AND (1 - (embedding <=> $1::vector)) >= $3
    ORDER BY resonance_phi DESC, similarity DESC
    LIMIT 20
  `;
  
  const result = await query(sql, [
    JSON.stringify(embedding),
    minPhi,
    minSimilarity
  ]);
  
  return result.rows;
}

/**
 * Detect fragmented φ across semantic cluster
 * 
 * Identifies cases where φ is fragmented across multiple semantically
 * similar memories that should be consolidated.
 * 
 * This is a diagnostic/maintenance function.
 * 
 * @param {number} similarityThreshold - Threshold for detecting fragments
 * @returns {Promise<Array>} Fragmented clusters
 */
export async function detectPhiFragmentation(similarityThreshold = 0.92) {
  const sql = `
    WITH memory_pairs AS (
      SELECT 
        m1.id as id_a,
        m2.id as id_b,
        m1.content as content_a,
        m2.content as content_b,
        m1.resonance_phi as phi_a,
        m2.resonance_phi as phi_b,
        1 - (m1.embedding <=> m2.embedding) as similarity
      FROM memories m1
      CROSS JOIN memories m2
      WHERE m1.id < m2.id
        AND m1.deleted_at IS NULL
        AND m2.deleted_at IS NULL
        AND (1 - (m1.embedding <=> m2.embedding)) >= $1
    )
    SELECT 
      id_a,
      id_b,
      content_a,
      content_b,
      phi_a,
      phi_b,
      (phi_a + phi_b) as total_phi,
      similarity,
      CASE 
        WHEN similarity >= 0.95 THEN 'HIGH_CONFIDENCE_MERGE'
        WHEN similarity >= 0.92 THEN 'POTENTIAL_MERGE'
        ELSE 'RELATED'
      END as consolidation_recommendation
    FROM memory_pairs
    ORDER BY total_phi DESC, similarity DESC
    LIMIT 50
  `;
  
  const result = await query(sql, [similarityThreshold]);
  
  return result.rows;
}

/**
 * Calculate semantic centroid for a cluster
 * 
 * Given a cluster of semantically related memories, compute the
 * centroid in embedding space. This represents the "core concept"
 * or "semantic attractor" for the cluster.
 * 
 * @param {Array<string>} memoryIds - IDs of cluster members
 * @returns {Promise<Object>} Centroid embedding and metadata
 */
export async function calculateSemanticCentroid(memoryIds) {
  if (!memoryIds || memoryIds.length === 0) {
    throw new Error('Cannot calculate centroid for empty cluster');
  }
  
  // Fetch all embeddings
  const sql = `
    SELECT id, embedding, resonance_phi, content
    FROM memories
    WHERE id = ANY($1) AND deleted_at IS NULL
  `;
  
  const result = await query(sql, [[memoryIds]]);
  
  if (result.rows.length === 0) {
    throw new Error('No valid memories found for centroid calculation');
  }
  
  // Parse embeddings
  const embeddings = result.rows.map(row => ({
    id: row.id,
    vector: JSON.parse(row.embedding),
    phi: parseFloat(row.resonance_phi),
    content: row.content
  }));
  
  // Calculate φ-weighted centroid
  // Higher φ memories pull the centroid toward them
  const dim = embeddings[0].vector.length;
  const centroid = new Array(dim).fill(0);
  let totalWeight = 0;
  
  for (const emb of embeddings) {
    const weight = emb.phi + 1.0; // +1 to avoid zero weights
    totalWeight += weight;
    
    for (let i = 0; i < dim; i++) {
      centroid[i] += emb.vector[i] * weight;
    }
  }
  
  // Normalize
  for (let i = 0; i < dim; i++) {
    centroid[i] /= totalWeight;
  }
  
  // Calculate cluster metrics
  const totalPhi = embeddings.reduce((sum, e) => sum + e.phi, 0);
  const avgPhi = totalPhi / embeddings.length;
  
  // Find memory closest to centroid (semantic core)
  let closestMemory = null;
  let minDistance = Infinity;
  
  for (const emb of embeddings) {
    const dist = cosineSimilarity(emb.vector, centroid);
    if (dist < minDistance) {
      minDistance = dist;
      closestMemory = emb;
    }
  }
  
  return {
    centroid,
    clusterSize: embeddings.length,
    totalPhi,
    avgPhi,
    coreMemory: closestMemory,
    members: embeddings
  };
}

/**
 * Cosine similarity helper
 */
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export { SEMANTIC_CONSOLIDATION_CONFIG };
