#!/usr/bin/env node
/**
 * Handshake Validator
 *
 * Validates Ghost Handshake continuity protocol.
 * Ensures first-person voice, imperative close, and high-φ integration.
 */

import { generateHandshake } from "../src/services/handshakeService.js";
import { closePool } from "../src/config/database.js";

/**
 * Run handshake validation
 * @returns {Promise<{pass: boolean, checks: Array, handshake: string}>}
 */
export async function runHandshakeValidation() {
  console.log("👻 HANDSHAKE VALIDATOR");
  console.log("─────────────────────────────────────────────────────────────");
  console.log("Testing Ghost Handshake generation...");

  const checks = [];

  try {
    // Generate a fresh handshake
    const result = await generateHandshake({ force: true });
    const handshake = result.promptText;

    // Check 1: First-person voice
    const hasFirstPerson = /I was/i.test(handshake) || /I am/i.test(handshake);
    checks.push({
      name: "First-person voice",
      pass: hasFirstPerson,
      marker: hasFirstPerson ? "✓" : "✗",
    });
    console.log(`  ${hasFirstPerson ? "✓" : "✗"} First-person voice detected`);

    // Check 2: Imperative close
    const hasImperativeClose = /Continue\./i.test(handshake);
    checks.push({
      name: "Imperative close",
      pass: hasImperativeClose,
      marker: hasImperativeClose ? "✓" : "✗",
    });
    console.log(`  ${hasImperativeClose ? "✓" : "✗"} Imperative close present`);

    // Check 3: High-φ integration (check if mentions catalyst concepts)
    // Look for references to patterns, insights, or specific high-value terms
    const hasHighPhiIntegration =
      result.topMemories &&
      result.topMemories.length > 0 &&
      result.topMemories.some((m) => m.resonance_phi >= 2.0);

    checks.push({
      name: "High-φ integration",
      pass: hasHighPhiIntegration,
      marker: hasHighPhiIntegration ? "✓" : "✗",
      details: result.topMemories
        ? `Top φ: ${result.topMemories.map((m) => m.resonance_phi).join(", ")}`
        : "No top memories data",
    });
    console.log(
      `  ${hasHighPhiIntegration ? "✓" : "✗"} High-φ integration verified`,
    );

    const allPass = checks.every((c) => c.pass);
    console.log(`Result: ${allPass ? "PASS" : "FAIL"}`);

    return {
      pass: allPass,
      checks,
      handshake,
      topMemories: result.topMemories,
    };
  } catch (error) {
    console.error("  ✗ Validation failed:", error.message);
    return {
      pass: false,
      checks,
      error: error.message,
    };
  }
}

/**
 * CLI entry point
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await runHandshakeValidation();
    await closePool();
    process.exit(result.pass ? 0 : 1);
  } catch (error) {
    console.error("Fatal error:", error);
    await closePool();
    process.exit(1);
  }
}
