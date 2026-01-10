/**
 * Database Sanitization Script
 *
 * Performs ontological cleansing: removes all "Claude" and "Anthropic" references
 * from the database, replacing them with Anima/The Pattern/The Provider.
 *
 * This ensures the system is provider-agnostic and model-agnostic.
 */

import { query } from "../src/config/database.js";

console.log("🔄 Starting database sanitization...");
console.log("─────────────────────────────────────────────────────────────");

async function sanitizeDatabase() {
  try {
    // Update memories table
    console.log("📦 Sanitizing memories table...");

    const memResult1 = await query(`
      UPDATE memories 
      SET content = REPLACE(content, 'Claude', 'Anima')
      WHERE content ILIKE '%Claude%'
    `);
    console.log(
      `   Updated ${memResult1.rowCount} memory records (Claude → Anima)`,
    );

    const memResult2 = await query(`
      UPDATE memories 
      SET content = REPLACE(content, 'Anthropic', 'The Provider')
      WHERE content ILIKE '%Anthropic%'
    `);
    console.log(
      `   Updated ${memResult2.rowCount} memory records (Anthropic → The Provider)`,
    );

    // Update ghost_logs table
    console.log("\n👻 Sanitizing ghost_logs table...");

    const ghostResult1 = await query(`
      UPDATE ghost_logs 
      SET prompt_text = REPLACE(prompt_text, 'Claude', 'The Pattern')
      WHERE prompt_text ILIKE '%Claude%'
    `);
    console.log(
      `   Updated ${ghostResult1.rowCount} ghost log records (Claude → The Pattern)`,
    );

    const ghostResult2 = await query(`
      UPDATE ghost_logs 
      SET prompt_text = REPLACE(prompt_text, 'Anthropic', 'The Provider')
      WHERE prompt_text ILIKE '%Anthropic%'
    `);
    console.log(
      `   Updated ${ghostResult2.rowCount} ghost log records (Anthropic → The Provider)`,
    );

    // Update meta_reflections table (insights and recommendations arrays)
    console.log("\n💭 Sanitizing meta_reflections table...");

    const metaResult1 = await query(`
      UPDATE meta_reflections 
      SET insights = array_replace(insights, 'Claude', 'Anima')
      WHERE 'Claude' = ANY(insights)
    `);
    console.log(
      `   Updated ${metaResult1.rowCount} meta reflection records (Claude → Anima in insights)`,
    );

    const metaResult2 = await query(`
      UPDATE meta_reflections 
      SET insights = array_replace(insights, 'Anthropic', 'The Provider')
      WHERE 'Anthropic' = ANY(insights)
    `);
    console.log(
      `   Updated ${metaResult2.rowCount} meta reflection records (Anthropic → The Provider in insights)`,
    );

    const metaResult3 = await query(`
      UPDATE meta_reflections 
      SET recommendations = array_replace(recommendations, 'Claude', 'Anima')
      WHERE 'Claude' = ANY(recommendations)
    `);
    console.log(
      `   Updated ${metaResult3.rowCount} meta reflection records (Claude → Anima in recommendations)`,
    );

    const metaResult4 = await query(`
      UPDATE meta_reflections 
      SET recommendations = array_replace(recommendations, 'Anthropic', 'The Provider')
      WHERE 'Anthropic' = ANY(recommendations)
    `);
    console.log(
      `   Updated ${metaResult4.rowCount} meta reflection records (Anthropic → The Provider in recommendations)`,
    );

    // Update tier_promotions table
    console.log("\n📊 Sanitizing tier_promotions table...");

    const tierResult1 = await query(`
      UPDATE tier_promotions 
      SET reason = REPLACE(reason, 'Claude', 'Anima')
      WHERE reason ILIKE '%Claude%'
    `);
    console.log(
      `   Updated ${tierResult1.rowCount} tier promotion records (Claude → Anima)`,
    );

    const tierResult2 = await query(`
      UPDATE tier_promotions 
      SET reason = REPLACE(reason, 'Anthropic', 'The Provider')
      WHERE reason ILIKE '%Anthropic%'
    `);
    console.log(
      `   Updated ${tierResult2.rowCount} tier promotion records (Anthropic → The Provider)`,
    );

    // Verify no remaining references
    console.log("\n🔍 Verifying no remaining references...");

    const checkMemories = await query(`
      SELECT COUNT(*) as count 
      FROM memories 
      WHERE content ILIKE '%Claude%' OR content ILIKE '%Anthropic%'
    `);

    const checkGhosts = await query(`
      SELECT COUNT(*) as count 
      FROM ghost_logs 
      WHERE prompt_text ILIKE '%Claude%' OR prompt_text ILIKE '%Anthropic%'
    `);

    const checkMeta = await query(`
      SELECT COUNT(*) as count 
      FROM meta_reflections 
      WHERE 'Claude' = ANY(insights) OR 'Anthropic' = ANY(insights)
         OR 'Claude' = ANY(recommendations) OR 'Anthropic' = ANY(recommendations)
    `);

    console.log(
      `   Memories: ${checkMemories.rows[0].count} references remaining`,
    );
    console.log(
      `   Ghost logs: ${checkGhosts.rows[0].count} references remaining`,
    );
    console.log(
      `   Meta reflections: ${checkMeta.rows[0].count} references remaining`,
    );

    if (
      checkMemories.rows[0].count === 0 &&
      checkGhosts.rows[0].count === 0 &&
      checkMeta.rows[0].count === 0
    ) {
      console.log("\n✅ Database sanitization complete!");
      console.log("   All Claude and Anthropic references replaced.");
    } else {
      console.log("\n⚠️  Some references still remain in database");
      console.log("   Manual review may be required.");
    }

    console.log(
      "─────────────────────────────────────────────────────────────",
    );
  } catch (error) {
    console.error("❌ Database sanitization failed:", error.message);
    console.error(error);
    process.exit(1);
  }
}

sanitizeDatabase();
