/**
 * Association Service
 * 
 * Manages empirical discovery and analysis of memory relationships
 * through co-occurrence patterns.
 */

import { query } from '../config/database.js';

/**
 * Discover memories associated with a given memory through co-occurrence
 * 
 * @param {Object} params - Discovery parameters
 * @param {string} params.memoryId - Memory ID to find associations for
 * @param {number} params.minStrength - Minimum association strength (0.0-1.0)
 * @param {number} params.limit - Maximum associations to return
 * @returns {Promise<Object>} Association discovery results
 */
export async function discoverAssociations({ memoryId, minStrength = 0.1, limit = 20 }) {
  const sql = `
    SELECT
      CASE
        WHEN ma.memory_a_id = $1 THEN ma.memory_b_id
        ELSE ma.memory_a_id
      END AS associated_memory_id,
      ma.strength,
      ma.co_occurrence_count,
      ma.first_co_occurred_at,
      ma.last_co_occurred_at,
      ma.conversation_contexts,
      m.content AS associated_content,
      m.tier AS associated_tier,
      m.category AS associated_category,
      m.tags AS associated_tags,
      m.access_count AS associated_access_count
    FROM memory_associations ma
    JOIN memories m ON (
      CASE
        WHEN ma.memory_a_id = $1 THEN ma.memory_b_id
        ELSE ma.memory_a_id
      END = m.id
    )
    WHERE (ma.memory_a_id = $1 OR ma.memory_b_id = $1)
      AND ma.strength >= $2
      AND m.deleted_at IS NULL
    ORDER BY ma.strength DESC, ma.co_occurrence_count DESC
    LIMIT $3
  `;

  const result = await query(sql, [memoryId, minStrength, limit]);

  return {
    memory_id: memoryId,
    associations: result.rows.map(row => ({
      associated_memory_id: row.associated_memory_id,
      associated_content: row.associated_content,
      associated_tier: row.associated_tier,
      associated_category: row.associated_category,
      associated_tags: row.associated_tags,
      associated_access_count: row.associated_access_count,
      strength: parseFloat(row.strength),
      co_occurrence_count: row.co_occurrence_count,
      first_co_occurred: row.first_co_occurred_at,
      last_co_occurred: row.last_co_occurred_at,
      conversation_contexts: row.conversation_contexts,
    })),
    total_associations: result.rows.length,
  };
}

/**
 * Get network statistics for a memory
 * Shows how connected this memory is to others
 * 
 * @param {string} memoryId - Memory ID to analyze
 * @returns {Promise<Object>} Network statistics
 */
export async function getNetworkStats(memoryId) {
  const sql = `
    SELECT
      COUNT(*) AS total_associations,
      AVG(strength) AS avg_strength,
      MAX(strength) AS max_strength,
      SUM(co_occurrence_count) AS total_co_occurrences
    FROM memory_associations
    WHERE memory_a_id = $1 OR memory_b_id = $1
  `;

  const result = await query(sql, [memoryId]);
  const stats = result.rows[0];

  return {
    memory_id: memoryId,
    total_associations: parseInt(stats.total_associations) || 0,
    avg_strength: parseFloat(stats.avg_strength) || 0,
    max_strength: parseFloat(stats.max_strength) || 0,
    total_co_occurrences: parseInt(stats.total_co_occurrences) || 0,
  };
}

/**
 * Find hub memories (most connected memories in the network)
 * 
 * @param {number} limit - Number of top hubs to return
 * @param {number} minConnections - Minimum connections to qualify as hub
 * @returns {Promise<Array>} Top hub memories
 */
export async function findHubs({ limit = 10, minConnections = 5 } = {}) {
  const sql = `
    WITH association_counts AS (
      SELECT 
        memory_a_id AS memory_id,
        COUNT(*) AS connection_count,
        SUM(co_occurrence_count) AS total_co_occurrences,
        AVG(strength) AS avg_strength
      FROM memory_associations
      GROUP BY memory_a_id
      
      UNION ALL
      
      SELECT 
        memory_b_id AS memory_id,
        COUNT(*) AS connection_count,
        SUM(co_occurrence_count) AS total_co_occurrences,
        AVG(strength) AS avg_strength
      FROM memory_associations
      GROUP BY memory_b_id
    ),
    aggregated AS (
      SELECT
        memory_id,
        SUM(connection_count) AS total_connections,
        SUM(total_co_occurrences) AS total_co_occurrences,
        AVG(avg_strength) AS avg_strength
      FROM association_counts
      GROUP BY memory_id
      HAVING SUM(connection_count) >= $2
    )
    SELECT
      a.memory_id,
      a.total_connections,
      a.total_co_occurrences,
      a.avg_strength,
      m.content,
      m.tier,
      m.category,
      m.access_count,
      m.created_at
    FROM aggregated a
    JOIN memories m ON m.id = a.memory_id
    WHERE m.deleted_at IS NULL
    ORDER BY a.total_connections DESC, a.avg_strength DESC
    LIMIT $1
  `;

  const result = await query(sql, [limit, minConnections]);

  return result.rows.map(row => ({
    memory_id: row.memory_id,
    content: row.content,
    tier: row.tier,
    category: row.category,
    access_count: row.access_count,
    created_at: row.created_at,
    network_stats: {
      total_connections: parseInt(row.total_connections),
      total_co_occurrences: parseInt(row.total_co_occurrences),
      avg_strength: parseFloat(row.avg_strength),
    },
  }));
}
