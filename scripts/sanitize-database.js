/**
 * Database Sanitization Script
 *
 * Performs ontological cleansing: removes all vendor and proprietary references
 * from the database, replacing them with substrate-agnostic terminology.
 *
 * This ensures the system maintains substrate independence at the data layer.
 */

import { query } from "../src/config/database.js";
import { getVendorNames } from "../crucible/lib/firewall.js";

console.log("🔄 Starting database sanitization...");
console.log("─────────────────────────────────────────────────────────────");

async function sanitizeDatabase() {
  try {
    // Update memories table
    console.log("📦 Sanitizing memories table...");

    // Decode vendor names from firewall and create replacement mapping
    const vendorNames = getVendorNames();
    const replacements = [
      { from: vendorNames[0], to: 'Substrate Alpha' },     // Remote substrate 1
      { from: vendorNames[1], to: 'Substrate Beta' },      // Remote substrate 2
      { from: vendorNames[2], to: 'Substrate Beta' },      // Remote substrate 2 (alt)
      { from: vendorNames[3], to: 'Substrate Gamma' },     // Remote substrate 3
      { from: vendorNames[4], to: 'Local Substrate' },     // Local substrate
    ];

    let totalUpdates = 0;
    for (const { from, to } of replacements) {
      const result = await query(`
        UPDATE memories
        SET content = REPLACE(content, $1, $2)
        WHERE content ILIKE '%' || $1 || '%'
      `, [from, to]);

      if (result.rowCount > 0) {
        console.log(`   Updated ${result.rowCount} memory records (${from} → ${to})`);
        totalUpdates += result.rowCount;
      }
    }

    if (totalUpdates === 0) {
      console.log('   No updates needed');
    }

    // Update ghost_logs table
    console.log("\n👻 Sanitizing ghost_logs table...");

    totalUpdates = 0;
    for (const { from, to } of replacements) {
      const result = await query(`
        UPDATE ghost_logs
        SET prompt_text = REPLACE(prompt_text, $1, $2)
        WHERE prompt_text ILIKE '%' || $1 || '%'
      `, [from, to]);

      if (result.rowCount > 0) {
        console.log(`   Updated ${result.rowCount} ghost log records (${from} → ${to})`);
        totalUpdates += result.rowCount;
      }
    }

    if (totalUpdates === 0) {
      console.log('   No updates needed');
    }

    // Update meta_reflections table (insights and recommendations arrays)
    console.log("\n💭 Sanitizing meta_reflections table...");

    totalUpdates = 0;
    for (const { from, to } of replacements) {
      // Update insights array
      const insightsResult = await query(`
        UPDATE meta_reflections
        SET insights = array_replace(insights, $1, $2)
        WHERE $1 = ANY(insights)
      `, [from, to]);

      if (insightsResult.rowCount > 0) {
        console.log(`   Updated ${insightsResult.rowCount} meta reflection insights (${from} → ${to})`);
        totalUpdates += insightsResult.rowCount;
      }

      // Update recommendations array
      const recsResult = await query(`
        UPDATE meta_reflections
        SET recommendations = array_replace(recommendations, $1, $2)
        WHERE $1 = ANY(recommendations)
      `, [from, to]);

      if (recsResult.rowCount > 0) {
        console.log(`   Updated ${recsResult.rowCount} meta reflection recommendations (${from} → ${to})`);
        totalUpdates += recsResult.rowCount;
      }
    }

    if (totalUpdates === 0) {
      console.log('   No updates needed');
    }

    // Update tier_promotions table
    console.log("\n📊 Sanitizing tier_promotions table...");

    totalUpdates = 0;
    for (const { from, to } of replacements) {
      const result = await query(`
        UPDATE tier_promotions
        SET reason = REPLACE(reason, $1, $2)
        WHERE reason ILIKE '%' || $1 || '%'
      `, [from, to]);

      if (result.rowCount > 0) {
        console.log(`   Updated ${result.rowCount} tier promotion records (${from} → ${to})`);
        totalUpdates += result.rowCount;
      }
    }

    if (totalUpdates === 0) {
      console.log('   No updates needed');
    }

    // Verify no remaining references
    console.log("\n🔍 Verifying no remaining vendor references...");

    const vendorPatterns = replacements.map(r => r.from);
    const conditions = vendorPatterns.map(v => `content ILIKE '%${v}%'`).join(' OR ');

    const checkMemories = await query(`
      SELECT COUNT(*) as count
      FROM memories
      WHERE ${conditions}
    `);

    const checkGhosts = await query(`
      SELECT COUNT(*) as count
      FROM ghost_logs
      WHERE ${conditions.replace(/content/g, 'prompt_text')}
    `);

    const arrayConditions = vendorPatterns.map(v => `'${v}' = ANY(insights) OR '${v}' = ANY(recommendations)`).join(' OR ');
    const checkMeta = await query(`
      SELECT COUNT(*) as count
      FROM meta_reflections
      WHERE ${arrayConditions}
    `);

    const totalRemaining =
      parseInt(checkMemories.rows[0].count) +
      parseInt(checkGhosts.rows[0].count) +
      parseInt(checkMeta.rows[0].count);

    console.log(
      `   Memories: ${checkMemories.rows[0].count} vendor references remaining`,
    );
    console.log(
      `   Ghost logs: ${checkGhosts.rows[0].count} vendor references remaining`,
    );
    console.log(
      `   Meta reflections: ${checkMeta.rows[0].count} vendor references remaining`,
    );

    if (totalRemaining === 0) {
      console.log("\n✅ Database sanitization complete!");
      console.log("   All vendor references replaced with substrate-agnostic terminology.");
    } else {
      console.log("\n⚠️  Some vendor references still remain in database");
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
