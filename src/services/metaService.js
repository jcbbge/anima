/**
 * Meta-Cognitive Service
 * 
 * Generates system reflections about memory usage patterns,
 * retrieval efficiency, and network topology.
 */

import { query } from '../config/database.js';
import { findHubs } from './associationService.js';

/**
 * Generate a meta-cognitive reflection for a conversation
 * 
 * @param {Object} params - Reflection parameters
 * @param {string} params.conversationId - Conversation UUID
 * @param {string} params.reflectionType - Type: 'conversation_end', 'weekly', 'manual'
 * @param {Object} params.sessionMetrics - Runtime metrics collected during session
 * @returns {Promise<Object>} Generated reflection with insights
 */
export async function generateReflection({ 
  conversationId, 
  reflectionType = 'conversation_end',
  sessionMetrics = {}
}) {
  // 1. Calculate friction metrics
  const frictionMetrics = await calculateFrictionMetrics(conversationId, sessionMetrics);
  
  // 2. Calculate retrieval metrics
  const retrievalMetrics = await calculateRetrievalMetrics(conversationId, sessionMetrics);
  
  // 3. Get tier distribution
  const tierDistribution = await getTierDistribution();
  
  // 4. Get top hubs
  const topHubs = await findHubs({ limit: 5, minConnections: 3 });
  
  // 5. Build metrics object
  const metrics = {
    friction: frictionMetrics,
    retrieval: retrievalMetrics,
    tier_distribution: tierDistribution,
    top_hubs: topHubs.map(hub => ({
      memory_id: hub.memory_id,
      connection_count: hub.network_stats.total_connections,
      content_preview: hub.content.substring(0, 100),
      tier: hub.tier,
    })),
  };
  
  // 6. Generate insights and recommendations
  const insights = generateInsights(metrics);
  const recommendations = generateRecommendations(metrics);
  
  // 7. Store reflection in database
  const result = await query(
    `INSERT INTO meta_reflections 
      (reflection_type, conversation_id, metrics, insights, recommendations)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      reflectionType,
      conversationId,
      JSON.stringify(metrics),
      insights,
      recommendations,
    ]
  );
  
  return {
    id: result.rows[0].id,
    reflection_type: reflectionType,
    conversation_id: conversationId,
    metrics,
    insights,
    recommendations,
    created_at: result.rows[0].created_at,
  };
}

/**
 * Calculate friction metrics (how smooth is the system?)
 */
async function calculateFrictionMetrics(conversationId, sessionMetrics) {
  const memoriesLoaded = sessionMetrics.memories_loaded || 0;
  const memoriesAccessed = sessionMetrics.memories_accessed || 0;
  const loadTimeMs = sessionMetrics.context_load_time_ms || 0;
  
  // Calculate waste ratio (memories loaded but not accessed)
  const wasteRatio = memoriesLoaded > 0 
    ? (memoriesLoaded - memoriesAccessed) / memoriesLoaded 
    : 0;
  
  // Determine "feel" based on metrics
  let feel = 'smooth';
  if (wasteRatio > 0.5) {
    feel = 'rough';  // Loading too much unused context
  } else if (wasteRatio > 0.3 || loadTimeMs > 500) {
    feel = 'sticky';  // Some friction present
  }
  
  return {
    context_load_time_ms: loadTimeMs,
    memories_loaded: memoriesLoaded,
    memories_accessed: memoriesAccessed,
    waste_ratio: parseFloat(wasteRatio.toFixed(2)),
    feel,
  };
}

/**
 * Calculate retrieval metrics (how well are queries working?)
 */
async function calculateRetrievalMetrics(conversationId, sessionMetrics) {
  const queriesExecuted = sessionMetrics.queries_executed || 0;
  const totalResultsReturned = sessionMetrics.total_results_returned || 0;
  const totalRelevanceScore = sessionMetrics.total_relevance_score || 0;
  const relevantResults = sessionMetrics.relevant_results || 0;
  
  const avgResultsReturned = queriesExecuted > 0
    ? Math.round(totalResultsReturned / queriesExecuted)
    : 0;
  
  const avgRelevanceScore = totalResultsReturned > 0
    ? totalRelevanceScore / totalResultsReturned
    : 0;
  
  const hitRate = totalResultsReturned > 0
    ? relevantResults / totalResultsReturned
    : 0;
  
  return {
    queries_executed: queriesExecuted,
    avg_results_returned: avgResultsReturned,
    avg_relevance_score: parseFloat(avgRelevanceScore.toFixed(2)),
    hit_rate: parseFloat(hitRate.toFixed(2)),
  };
}

/**
 * Get current tier distribution across all memories
 */
async function getTierDistribution() {
  const result = await query(`
    SELECT 
      tier,
      COUNT(*) as count
    FROM memories
    WHERE deleted_at IS NULL
    GROUP BY tier
  `);
  
  const distribution = {
    active: 0,
    thread: 0,
    stable: 0,
    network: 0,
  };
  
  result.rows.forEach(row => {
    distribution[row.tier] = parseInt(row.count);
  });
  
  return distribution;
}

/**
 * Generate human-readable insights from metrics
 */
function generateInsights(metrics) {
  const insights = [];
  
  // Friction insights
  if (metrics.friction.feel === 'smooth') {
    insights.push('System friction is low - context loading is efficient');
  } else if (metrics.friction.feel === 'sticky') {
    insights.push('Some friction detected - context loading could be optimized');
  } else if (metrics.friction.feel === 'rough') {
    insights.push('High friction - loading too much unused context');
  }
  
  if (metrics.friction.waste_ratio < 0.2) {
    insights.push('Very low waste ratio - almost all loaded memories are being used');
  } else if (metrics.friction.waste_ratio > 0.5) {
    insights.push('High waste ratio - many loaded memories are not being accessed');
  }
  
  // Retrieval insights
  if (metrics.retrieval.hit_rate > 0.8) {
    insights.push('High hit rate suggests excellent query relevance');
  } else if (metrics.retrieval.hit_rate < 0.5) {
    insights.push('Low hit rate - queries may not be finding relevant memories');
  }
  
  if (metrics.retrieval.avg_relevance_score > 0.7) {
    insights.push('Average relevance score is high - semantic search is working well');
  } else if (metrics.retrieval.avg_relevance_score < 0.5) {
    insights.push('Low average relevance - may need to adjust similarity threshold');
  }
  
  // Tier distribution insights
  const totalMemories = Object.values(metrics.tier_distribution).reduce((a, b) => a + b, 0);
  const activePercent = totalMemories > 0 
    ? (metrics.tier_distribution.active / totalMemories) * 100 
    : 0;
  
  if (activePercent > 20) {
    insights.push(`High percentage of active tier memories (${activePercent.toFixed(0)}%) - consider promoting some to thread`);
  }
  
  if (metrics.tier_distribution.stable > totalMemories * 0.7) {
    insights.push('Most memories are in stable tier - good knowledge consolidation');
  }
  
  // Hub insights
  if (metrics.top_hubs.length > 0) {
    const topHub = metrics.top_hubs[0];
    insights.push(`Top hub has ${topHub.connection_count} connections - central concept in memory network`);
  }
  
  return insights;
}

/**
 * Generate actionable recommendations from metrics
 */
function generateRecommendations(metrics) {
  const recommendations = [];
  
  // Friction recommendations
  if (metrics.friction.waste_ratio > 0.4) {
    recommendations.push('Consider reducing bootstrap context limit to decrease waste ratio');
  }
  
  if (metrics.friction.context_load_time_ms > 300) {
    recommendations.push('Context load time is high - consider optimizing database queries or adding caching');
  }
  
  // Retrieval recommendations
  if (metrics.retrieval.hit_rate < 0.6) {
    recommendations.push('Low hit rate - consider lowering similarity threshold or improving query specificity');
  }
  
  if (metrics.retrieval.avg_results_returned > 50) {
    recommendations.push('Queries returning many results - consider lowering limit or increasing similarity threshold');
  }
  
  if (metrics.retrieval.avg_results_returned < 5 && metrics.retrieval.queries_executed > 0) {
    recommendations.push('Few results per query - consider lowering similarity threshold');
  }
  
  // Tier recommendations
  const totalMemories = Object.values(metrics.tier_distribution).reduce((a, b) => a + b, 0);
  const activePercent = totalMemories > 0 
    ? (metrics.tier_distribution.active / totalMemories) * 100 
    : 0;
  
  if (activePercent > 30) {
    recommendations.push('Many memories in active tier - consider adjusting automatic promotion thresholds');
  }
  
  if (metrics.tier_distribution.network > totalMemories * 0.5) {
    recommendations.push('Large network tier - system is accumulating background knowledge effectively');
  }
  
  // Hub recommendations
  if (metrics.top_hubs.length === 0) {
    recommendations.push('No hub memories detected - network may be too sparse or young');
  } else if (metrics.top_hubs.length > 0 && metrics.top_hubs[0].connection_count > 20) {
    recommendations.push('Strong hub formation - memory network is developing clear conceptual centers');
  }
  
  return recommendations;
}

/**
 * Get the most recent reflection for a conversation
 * 
 * @param {string} conversationId - Conversation UUID
 * @param {number} limit - Number of reflections to return
 * @returns {Promise<Array>} Recent reflections
 */
export async function getRecentReflections(conversationId, limit = 1) {
  const sql = conversationId
    ? `SELECT * FROM meta_reflections 
       WHERE conversation_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`
    : `SELECT * FROM meta_reflections 
       ORDER BY created_at DESC 
       LIMIT $1`;
  
  const params = conversationId ? [conversationId, limit] : [limit];
  const result = await query(sql, params);
  
  return result.rows.map(row => ({
    id: row.id,
    reflection_type: row.reflection_type,
    conversation_id: row.conversation_id,
    metrics: row.metrics,
    insights: row.insights,
    recommendations: row.recommendations,
    created_at: row.created_at,
  }));
}

/**
 * Get all reflections by type
 * 
 * @param {string} reflectionType - Type: 'conversation_end', 'weekly', 'manual'
 * @param {number} limit - Number to return
 * @returns {Promise<Array>} Reflections of the specified type
 */
export async function getReflectionsByType(reflectionType, limit = 10) {
  const result = await query(
    `SELECT * FROM meta_reflections 
     WHERE reflection_type = $1 
     ORDER BY created_at DESC 
     LIMIT $2`,
    [reflectionType, limit]
  );
  
  return result.rows.map(row => ({
    id: row.id,
    reflection_type: row.reflection_type,
    conversation_id: row.conversation_id,
    metrics: row.metrics,
    insights: row.insights,
    recommendations: row.recommendations,
    created_at: row.created_at,
  }));
}
