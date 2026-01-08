/**
 * Tier Service
 * 
 * Business logic for tier management:
 * - Updating memory tiers
 * - Recording tier promotions
 * - Checking promotion thresholds
 */

import { query } from '../config/database.js';

/**
 * Tier promotion thresholds
 */
const TIER_THRESHOLDS = {
  thread: 3,   // Promote to thread at 3 accesses
  stable: 10,  // Promote to stable at 10 accesses
};

/**
 * Custom error class for tier service errors
 */
class TierServiceError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'TierServiceError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Check if memory should be promoted based on access count
 * 
 * @param {number} accessCount - Current access count
 * @param {string} currentTier - Current tier
 * @returns {{shouldPromote: boolean, newTier?: string}}
 */
export function checkPromotionThreshold(accessCount, currentTier) {
  // Promotion rules:
  // active → thread at 3 accesses
  // thread → stable at 10 accesses
  // stable → stays stable (no further promotion)
  // network → stays network (special tier)

  if (currentTier === 'active' && accessCount >= TIER_THRESHOLDS.thread) {
    return { shouldPromote: true, newTier: 'thread' };
  }

  if (currentTier === 'thread' && accessCount >= TIER_THRESHOLDS.stable) {
    return { shouldPromote: true, newTier: 'stable' };
  }

  return { shouldPromote: false };
}

/**
 * Record a tier promotion in the audit trail
 * 
 * @param {Object} promotionData - Promotion details
 * @param {string} promotionData.memoryId - Memory UUID
 * @param {string} promotionData.fromTier - Original tier
 * @param {string} promotionData.toTier - New tier
 * @param {string} promotionData.reason - Promotion reason
 * @param {number} [promotionData.accessCountAtPromotion] - Access count at promotion
 * @param {number} [promotionData.daysSinceLastAccess] - Days since last access
 * @returns {Promise<Object>} Promotion record
 */
export async function recordTierPromotion(promotionData) {
  const {
    memoryId,
    fromTier,
    toTier,
    reason,
    accessCountAtPromotion,
    daysSinceLastAccess,
  } = promotionData;

  const result = await query(
    `INSERT INTO tier_promotions (
      memory_id,
      from_tier,
      to_tier,
      reason,
      access_count_at_promotion,
      days_since_last_access
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, memory_id, from_tier, to_tier, reason, created_at`,
    [
      memoryId,
      fromTier,
      toTier,
      reason,
      accessCountAtPromotion || null,
      daysSinceLastAccess || null,
    ]
  );

  return result.rows[0];
}

/**
 * Update memory tier and record promotion
 * 
 * @param {Object} updateData - Tier update details
 * @param {string} updateData.memoryId - Memory UUID
 * @param {string} updateData.newTier - New tier to set
 * @param {string} updateData.reason - Reason for tier change
 * @param {number} [updateData.accessCount] - Current access count (for audit)
 * @returns {Promise<{memory: Object, promotion: Object}>}
 */
export async function updateMemoryTier(updateData) {
  const { memoryId, newTier, reason, accessCount } = updateData;

  // Validate tier
  const validTiers = ['active', 'thread', 'stable', 'network'];
  if (!validTiers.includes(newTier)) {
    throw new TierServiceError(
      `Invalid tier: ${newTier}`,
      'INVALID_TIER',
      { tier: newTier, validTiers }
    );
  }

  // Get current memory state
  const currentResult = await query(
    'SELECT id, tier, access_count, last_accessed FROM memories WHERE id = $1 AND deleted_at IS NULL',
    [memoryId]
  );

  if (currentResult.rows.length === 0) {
    throw new TierServiceError(
      'Memory not found',
      'MEMORY_NOT_FOUND',
      { memoryId }
    );
  }

  const currentMemory = currentResult.rows[0];
  const fromTier = currentMemory.tier;

  // Don't update if already at target tier
  if (fromTier === newTier) {
    return {
      memory: currentMemory,
      promotion: null,
      message: 'Memory already at target tier',
    };
  }

  // Calculate days since last access
  const lastAccessed = new Date(currentMemory.last_accessed);
  const now = new Date();
  const daysSinceLastAccess = (now - lastAccessed) / (1000 * 60 * 60 * 24);

  // Update memory tier
  const updateResult = await query(
    `UPDATE memories
     SET tier = $1,
         tier_last_updated = NOW(),
         updated_at = NOW()
     WHERE id = $2
     RETURNING id, tier, tier_last_updated, access_count, last_accessed, updated_at`,
    [newTier, memoryId]
  );

  const updatedMemory = updateResult.rows[0];

  // Record promotion
  const promotion = await recordTierPromotion({
    memoryId,
    fromTier,
    toTier: newTier,
    reason,
    accessCountAtPromotion: accessCount || currentMemory.access_count,
    daysSinceLastAccess: Math.round(daysSinceLastAccess * 100) / 100,
  });

  return {
    memory: updatedMemory,
    promotion,
    message: `Tier updated from ${fromTier} to ${newTier}`,
  };
}

/**
 * Check and promote memory if threshold reached
 * 
 * @param {string} memoryId - Memory UUID
 * @param {number} accessCount - Current access count
 * @param {string} currentTier - Current tier
 * @returns {Promise<{promoted: boolean, result?: Object}>}
 */
export async function checkAndPromote(memoryId, accessCount, currentTier) {
  const promotionCheck = checkPromotionThreshold(accessCount, currentTier);

  if (!promotionCheck.shouldPromote) {
    return { promoted: false };
  }

  const result = await updateMemoryTier({
    memoryId,
    newTier: promotionCheck.newTier,
    reason: 'access_threshold',
    accessCount,
  });

  return {
    promoted: true,
    result,
  };
}

export { TierServiceError, TIER_THRESHOLDS };
