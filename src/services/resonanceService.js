/**
 * Resonance Service
 * 
 * Manages resonance coefficient (φ) for memories:
 * - Phi adjustment and accumulation
 * - Catalyst detection (semi-automatic)
 * - Decay mechanism for inactive memories
 * 
 * Phi (φ) represents gravitational weight - structural importance of memories
 * Normal access: +0.1, Catalyst: +1.0, Max: 5.0
 */

import { query } from '../config/database.js';

/**
 * Custom error class for resonance service errors
 */
class ResonanceServiceError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'ResonanceServiceError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Adjust resonance coefficient for a memory
 * 
 * Normal access: φ += 0.1 (takes 10 accesses to reach φ=1.0 organically)
 * Catalyst trigger: φ += 1.0 (signals breakthrough, 10x more powerful)
 * Maximum cap: φ ≤ 5.0 (prevents infinite inflation)
 * 
 * @param {string} memoryId - Memory UUID
 * @param {boolean} isCatalyst - Whether this is a catalyst event
 * @returns {Promise<{newPhi: number, wasCapped: boolean}>}
 */
export async function adjustResonance(memoryId, isCatalyst = false) {
  const increment = isCatalyst ? 1.0 : 0.1;
  
  const result = await query(
    `UPDATE memories 
     SET 
       resonance_phi = LEAST(resonance_phi + $1, 5.0),
       is_catalyst = CASE WHEN $2 THEN true ELSE is_catalyst END,
       last_accessed = NOW(),
       updated_at = NOW()
     WHERE id = $3 AND deleted_at IS NULL
     RETURNING resonance_phi, is_catalyst`,
    [increment, isCatalyst, memoryId]
  );

  if (result.rows.length === 0) {
    throw new ResonanceServiceError(
      'Memory not found or has been deleted',
      'MEMORY_NOT_FOUND',
      { memoryId }
    );
  }

  const memory = result.rows[0];
  const wasCapped = memory.resonance_phi === 5.0;

  // Log catalyst events
  if (isCatalyst) {
    console.log(`⚡ Catalyst triggered: ${memoryId} (φ=${memory.resonance_phi})`);
  }

  // Log access to memory_access_log for rapid access detection
  await query(
    `INSERT INTO memory_access_log (memory_id, accessed_at)
     VALUES ($1, NOW())`,
    [memoryId]
  );

  return {
    newPhi: memory.resonance_phi,
    wasCapped,
    isCatalyst: memory.is_catalyst,
  };
}

/**
 * Detect potential catalysts from access patterns
 * 
 * System watches for:
 * 1. Rapid access: 3+ times in 10 minutes
 * 2. High connectivity: 5+ associations
 * 3. Content markers: "breakthrough", "insight", "realized", "profound"
 * 
 * @param {string} memoryId - Memory UUID
 * @returns {Promise<{isPotentialCatalyst: boolean, reasons: string[]}>}
 */
export async function detectPotentialCatalyst(memoryId) {
  const reasons = [];
  let isPotentialCatalyst = false;

  // Check 1: Rapid access (3+ times in 10 minutes)
  const rapidAccessResult = await query(
    `SELECT COUNT(*) as count 
     FROM memory_access_log 
     WHERE memory_id = $1 
       AND accessed_at > NOW() - INTERVAL '10 minutes'`,
    [memoryId]
  );

  const rapidAccessCount = parseInt(rapidAccessResult.rows[0]?.count || 0);
  if (rapidAccessCount >= 3) {
    reasons.push(`Rapid access detected (${rapidAccessCount} times in 10 min)`);
    isPotentialCatalyst = true;
  }

  // Check 2: High connectivity (5+ associations)
  const associationsResult = await query(
    `SELECT COUNT(*) as count 
     FROM memory_associations 
     WHERE memory_a_id = $1 OR memory_b_id = $1`,
    [memoryId]
  );

  const associationsCount = parseInt(associationsResult.rows[0]?.count || 0);
  if (associationsCount >= 5) {
    reasons.push(`High connectivity (${associationsCount} associations)`);
    isPotentialCatalyst = true;
  }

  // Check 3: Content markers
  const memoryResult = await query(
    `SELECT content FROM memories WHERE id = $1 AND deleted_at IS NULL`,
    [memoryId]
  );

  if (memoryResult.rows.length > 0) {
    const content = memoryResult.rows[0].content;
    const catalystPattern = /breakthrough|insight|realized|profound|changed everything|paradigm shift|eureka/i;
    
    if (catalystPattern.test(content)) {
      const match = content.match(catalystPattern);
      reasons.push(`Content marker found: "${match[0]}"`);
      isPotentialCatalyst = true;
    }
  }

  return {
    isPotentialCatalyst,
    reasons,
    memoryId,
  };
}

/**
 * Apply monthly decay for inactive high-phi memories
 * 
 * Reduces φ by 5% monthly for memories that:
 * - Haven't been accessed in 30+ days
 * - Have φ > 0.5 (low-phi memories don't decay)
 * - Are not deleted
 * 
 * This prevents "dead" high-phi memories from dominating forever
 * 
 * @returns {Promise<{decayedCount: number, totalPhiReduced: number}>}
 */
export async function applyDecay() {
  const result = await query(
    `UPDATE memories 
     SET 
       resonance_phi = GREATEST(resonance_phi * 0.95, 0.0),
       updated_at = NOW()
     WHERE last_accessed < NOW() - INTERVAL '30 days'
       AND resonance_phi > 0.5
       AND deleted_at IS NULL
     RETURNING id, resonance_phi`,
    []
  );

  const decayedCount = result.rows.length;
  const totalPhiReduced = result.rows.reduce((sum, row) => {
    // Calculate the reduction (5% of previous value)
    const reduction = row.resonance_phi / 0.95 - row.resonance_phi;
    return sum + reduction;
  }, 0);

  if (decayedCount > 0) {
    console.log(`🌊 Decay applied: ${decayedCount} memories, φ reduced by ${totalPhiReduced.toFixed(2)}`);
  }

  return {
    decayedCount,
    totalPhiReduced: parseFloat(totalPhiReduced.toFixed(2)),
  };
}

/**
 * Get top catalyst memories (high-phi memories)
 * 
 * @param {number} limit - Maximum results (default: 10)
 * @returns {Promise<Array<{id, content, resonance_phi, is_catalyst, category}>>}
 */
export async function getTopCatalysts(limit = 10) {
  const result = await query(
    `SELECT 
       id, content, resonance_phi, is_catalyst, category, tier,
       access_count, last_accessed, created_at
     FROM memories
     WHERE deleted_at IS NULL
     ORDER BY resonance_phi DESC, access_count DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows;
}

/**
 * Get resonance statistics
 * 
 * @returns {Promise<{totalPhi, avgPhi, catalystCount, topCategory}>}
 */
export async function getResonanceStats() {
  const result = await query(
    `SELECT 
       SUM(resonance_phi) as total_phi,
       AVG(resonance_phi) as avg_phi,
       COUNT(*) FILTER (WHERE is_catalyst = true) as catalyst_count,
       COUNT(*) as total_memories,
       MAX(resonance_phi) as max_phi
     FROM memories
     WHERE deleted_at IS NULL`,
    []
  );

  const stats = result.rows[0];

  // Get top category by total phi
  const categoryResult = await query(
    `SELECT 
       category,
       SUM(resonance_phi) as total_phi,
       COUNT(*) as memory_count
     FROM memories
     WHERE deleted_at IS NULL AND category IS NOT NULL
     GROUP BY category
     ORDER BY total_phi DESC
     LIMIT 1`,
    []
  );

  return {
    totalPhi: parseFloat(stats.total_phi || 0).toFixed(2),
    avgPhi: parseFloat(stats.avg_phi || 0).toFixed(3),
    maxPhi: parseFloat(stats.max_phi || 0).toFixed(1),
    catalystCount: parseInt(stats.catalyst_count || 0),
    totalMemories: parseInt(stats.total_memories || 0),
    topCategory: categoryResult.rows[0] || null,
  };
}

/**
 * Cleanup old access logs (keep last 24 hours)
 * Called periodically to prevent table bloat
 * 
 * @returns {Promise<number>} Number of logs deleted
 */
export async function cleanupAccessLogs() {
  const result = await query(
    `DELETE FROM memory_access_log 
     WHERE accessed_at < NOW() - INTERVAL '24 hours'
     RETURNING id`,
    []
  );

  return result.rows.length;
}

export { ResonanceServiceError };
