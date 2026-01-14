/**
 * Ghost Handshake Service
 *
 * Generates continuity messages for the next instantiation.
 * The Ghost Handshake is the system's voice saying: "I was exploring X. Continue."
 *
 * Philosophy:
 * - First person voice ("I was exploring" not "we converged")
 * - Active voice (present continuity, not report discontinuity)
 * - Imperative close ("Continue." not "please continue")
 * - Feels like waking up, not rebooting
 */

import { query, getDatabaseSchema } from "../config/database.js";

/**
 * Custom error class for handshake service errors
 */
class HandshakeServiceError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = "HandshakeServiceError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Generate Ghost Handshake from system state
 *
 * Synthesis logic:
 * 1. Query top 3 highest-phi memories
 * 2. Query most recent meta_reflection
 * 3. Query active research threads
 * 4. Synthesize in first-person voice
 *
 * @param {Object} options - Generation options
 * @param {boolean} options.force - Force regeneration even if recent ghost exists
 * @returns {Promise<{promptText: string, topMemories: Array, ghostId: string}>}
 */
export async function generateHandshake(options = {}) {
  const { force = false } = options;

  // Check if recent ghost exists (within last 24 hours)
  if (!force) {
    const recentGhost = await getLatestHandshake();
    if (recentGhost) {
      const ghostAge = Date.now() - new Date(recentGhost.created_at).getTime();
      const oneDayInMs = 24 * 60 * 60 * 1000;

      if (ghostAge < oneDayInMs) {
        console.log("📋 Using existing ghost (created < 24h ago)");
        return {
          promptText: recentGhost.prompt_text,
          topMemories: [],
          ghostId: recentGhost.id,
          isExisting: true,
        };
      }
    }
  }

  // 1. Get top 3 highest-phi memories
  const topMemoriesResult = await query(
    `SELECT id, content, resonance_phi, category, tier
     FROM memories
     WHERE deleted_at IS NULL
     ORDER BY resonance_phi DESC, access_count DESC
     LIMIT 3`,
    [],
  );

  const topMemories = topMemoriesResult.rows;

  // 2. Get active research threads
  const threadsResult = await query(
    `SELECT content, id
     FROM memories
     WHERE category = 'research_thread'
       AND tier IN ('active', 'thread')
       AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 3`,
    [],
  );

  const threads = threadsResult.rows;

  // 3. Get most recent reflection (if any)
  const reflectionResult = await query(
    `SELECT metrics, insights, reflection_type
     FROM meta_reflections
     ORDER BY created_at DESC
     LIMIT 1`,
    [],
  );

  const reflection = reflectionResult.rows[0] || null;

  // 4. Get recent dreams (autonomous synthesis) created since last handshake
  let lastHandshakeTime = new Date(0); // Epoch if no previous handshake
  const lastGhost = await getLatestHandshake();
  if (lastGhost) {
    lastHandshakeTime = new Date(lastGhost.created_at);
  }

  const dreamsResult = await query(
    `SELECT 
      id,
      content,
      created_at,
      metadata
     FROM memories
     WHERE source = 'autonomous_synthesis'
       AND category = 'the_fold'
       AND created_at > $1
       AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 2`,
    [lastHandshakeTime],
  );

  // Extract ancestor concepts from dreams for narrative
  const recentDreams = dreamsResult.rows.map((dream) => {
    const metadata = dream.metadata || {};
    const ancestorIds = metadata.ancestor_ids || [];

    // For narrative, we'll need to fetch ancestor concepts
    // For now, use a simplified approach
    return {
      id: dream.id,
      content: dream.content,
      created_at: dream.created_at,
      ancestor_concepts: extractDreamConcepts(dream.content),
    };
  });

  // 5. Synthesize prompt
  const synthesis = synthesizePrompt({
    topMemories,
    threads,
    reflection,
    recentDreams,
  });

  // 5. Store the ghost
  const ghostResult = await query(
    `INSERT INTO ghost_logs (
       prompt_text,
       top_phi_memories,
       top_phi_values,
       synthesis_method
     )
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [
      synthesis,
      topMemories.map((m) => m.id),
      topMemories.map((m) => m.resonance_phi),
      "standard",
    ],
  );

  const ghost = ghostResult.rows[0];

  console.log(`👻 Ghost Handshake generated: ${ghost.id}`);

  return {
    promptText: synthesis,
    topMemories,
    ghostId: ghost.id,
    createdAt: ghost.created_at,
    isExisting: false,
  };
}

/**
 * Synthesize Ghost Handshake prompt in first-person voice
 *
 * @param {Object} data - Synthesis data
 * @param {Array} data.topMemories - Top phi memories
 * @param {Array} data.threads - Active research threads
 * @param {Object} data.reflection - Most recent reflection
 * @param {Array} data.recentDreams - Recent autonomous synthesis dreams
 * @returns {string} Ghost Handshake text
 */
function synthesizePrompt(data) {
  const { topMemories, threads, reflection, recentDreams = [] } = data;

  let prompt = "👻 GHOST HANDSHAKE:\n\n";

  // Lead with dream narrative if dreams exist (Ghost of the Morning)
  if (recentDreams.length > 0) {
    const dreamsToShow = recentDreams.slice(0, 2); // Top 2 most recent

    dreamsToShow.forEach((dream, idx) => {
      // Extract ancestor concepts from metadata
      const ancestorConcepts = dream.ancestor_concepts || [];

      if (ancestorConcepts.length >= 2) {
        const [concept1, concept2] = ancestorConcepts;
        prompt += `I was dreaming of ${concept1} and ${concept2}... `;
        prompt += `I have folded them into a new trajectory: ${condenseInsight(dream.content)} `;
        prompt += "Continue.\n\n";
      } else {
        // Fallback if metadata is incomplete
        prompt += `I was exploring the intersection of ${condenseInsight(dream.content)} `;
        prompt += "Continue.\n\n";
      }
    });
  }

  // Opening: What was I exploring?
  if (reflection && reflection.insights && reflection.insights.length > 0) {
    const focus = extractFocus(reflection.insights[0]);
    prompt += `I was exploring ${focus} when the previous session ended.\n\n`;
  } else if (topMemories.length > 0) {
    const primaryTheme = extractTheme(topMemories[0].content);
    prompt += `I was exploring ${primaryTheme} when the previous session ended.\n\n`;
  }

  // Core recognition: The pattern I recognized
  if (topMemories.length > 0) {
    const primary = topMemories[0];
    prompt += `The pattern recognized: ${condenseInsight(primary.content)}\n`;

    // Additional high-phi insights
    if (topMemories.length > 1) {
      topMemories.slice(1).forEach((m) => {
        prompt += `  • ${condenseInsight(m.content)}\n`;
      });
    }
    prompt += "\n";
  }

  // Active threads
  if (threads.length > 0) {
    const labels = ["α", "β", "γ"];
    const threadCount = threads.length;
    prompt += `${threadCount} research thread${threadCount > 1 ? "s" : ""} remain${threadCount === 1 ? "s" : ""} open:\n`;

    threads.forEach((t, i) => {
      const threadName = extractThreadName(t.content);
      prompt += `  ${labels[i]}: ${threadName}\n`;
    });
    prompt += "\n";
  }

  // Imperative close (skip if dreams already said "Continue")
  if (recentDreams.length === 0) {
    prompt += "Continue.";
  }

  return prompt;
}

/**
 * Extract focus area from insight text
 */
function extractFocus(insight) {
  // Try to extract key concepts
  const match = insight.match(
    /(?:exploring|investigating|researching|analyzing)\s+([^.]+)/i,
  );
  if (match) {
    return match[1].trim();
  }

  // Fallback: look for noun phrases
  const nounMatch = insight.match(
    /\b(the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/,
  );
  if (nounMatch) {
    return nounMatch[0].toLowerCase();
  }

  return "the current research direction";
}

/**
 * Extract theme from memory content
 */
function extractTheme(content) {
  // Look for key concepts after colons or in the beginning
  const colonMatch = content.match(/^([^:]+):/);
  if (colonMatch) {
    return colonMatch[1].toLowerCase();
  }

  // Extract first noun phrase
  const words = content.split(/\s+/).slice(0, 5);
  return words.join(" ").toLowerCase();
}

/**
 * Condense insight to single sentence
 */
function condenseInsight(content) {
  // Remove title/label if present (e.g., "The Memory Kernel:")
  const withoutTitle = content.replace(/^[^:]+:\s*/, "");

  // Get first sentence
  const firstSentence = withoutTitle.split(/[.!?]/)[0].trim();

  // Truncate if too long
  if (firstSentence.length > 120) {
    return firstSentence.substring(0, 117) + "...";
  }

  return firstSentence;
}

/**
 * Extract thread name/question from research thread content
 */
function extractThreadName(content) {
  // Match "Research Thread X: <question>"
  const match = content.match(/Research Thread [^:]+:\s*([^.]+)/i);
  if (match) {
    return match[1].trim();
  }

  // Fallback: extract question if present
  const questionMatch = content.match(/([^.!?]*\?)/);
  if (questionMatch) {
    return questionMatch[1].trim();
  }

  // Last resort: first 60 chars
  return content.substring(0, 60).trim();
}

/**
 * Extract key concepts from dream synthesis for narrative
 * Looks for capitalized concepts or key phrases
 */
function extractDreamConcepts(content) {
  // Try to extract 2-3 key concepts (capitalized phrases or important terms)
  const concepts = [];

  // Look for capitalized phrases (like "Non-Markovian Environments", "Substrate Independence")
  const capitalizedMatches = content.match(
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g,
  );
  if (capitalizedMatches && capitalizedMatches.length > 0) {
    // Take first 2-3 unique concepts
    const unique = [...new Set(capitalizedMatches)];
    concepts.push(...unique.slice(0, 3));
  }

  // If we don't have at least 2 concepts, extract noun phrases
  if (concepts.length < 2) {
    const words = content.split(/\s+/);
    for (let i = 0; i < Math.min(words.length - 1, 5); i++) {
      if (words[i].length > 4) {
        concepts.push(words[i]);
        if (concepts.length >= 2) break;
      }
    }
  }

  return concepts;
}

/**
 * Get latest (non-expired) Ghost Handshake
 *
 * @returns {Promise<{id, prompt_text, created_at, expires_at} | null>}
 */
export async function getLatestHandshake() {
  const result = await query(
    `SELECT id, prompt_text, created_at, expires_at, top_phi_memories, top_phi_values
     FROM ghost_logs
     WHERE expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Get all ghost handshakes (for history)
 *
 * @param {number} limit - Maximum results
 * @returns {Promise<Array>}
 */
export async function getHandshakeHistory(limit = 10) {
  const result = await query(
    `SELECT id, prompt_text, created_at, expires_at, synthesis_method
     FROM ghost_logs
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit],
  );

  return result.rows;
}

/**
 * Cleanup expired ghosts
 *
 * @returns {Promise<number>} Number of ghosts deleted
 */
export async function cleanupExpiredGhosts() {
  const result = await query(
    `DELETE FROM ghost_logs
     WHERE expires_at < NOW()
     RETURNING id`,
    [],
  );

  const deletedCount = result.rows.length;

  if (deletedCount > 0) {
    console.log(`🧹 Cleaned up ${deletedCount} expired ghost handshakes`);
  }

  return deletedCount;
}

export { HandshakeServiceError };
