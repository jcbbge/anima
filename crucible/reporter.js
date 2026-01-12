/**
 * THE CRUCIBLE: MANIFESTATION REPORT
 *
 * Orchestrates all verification modules and generates the final verdict:
 * - Persistence Trace (3-Act Process Isolation)
 * - Math Guard (Harmonic Mean verification)
 * - Identity Scrub (Substrate Independence)
 *
 * Output: STABLE or UNSTABLE verdict with forensic details
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';

/**
 * Run a command and capture output
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || import.meta.dir,
      stdio: ['inherit', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      if (!options.silent) {
        process.stdout.write(text);
      }
    });

    child.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      if (!options.silent) {
        process.stderr.write(text);
      }
    });

    child.on('exit', (code) => {
      resolve({
        code,
        stdout,
        stderr,
        success: code === 0
      });
    });

    child.on('error', reject);
  });
}

/**
 * Parse test results from bun test output
 */
function parseTestResults(output) {
  const passMatch = output.match(/(\d+) pass/);
  const failMatch = output.match(/(\d+) fail/);
  const expectMatch = output.match(/(\d+) expect\(\) calls/);

  return {
    passed: passMatch ? parseInt(passMatch[1]) : 0,
    failed: failMatch ? parseInt(failMatch[1]) : 0,
    assertions: expectMatch ? parseInt(expectMatch[1]) : 0
  };
}

/**
 * Run Persistence Trace
 */
async function runPersistenceTrace() {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  🛡️  MODULE 1: PERSISTENCE TRACE                  ║');
  console.log('╚════════════════════════════════════════════════════╝');

  const startTime = Date.now();
  const result = await runCommand('bun', ['run', 'traces/persistence.trace.js']);
  const duration = Date.now() - startTime;

  return {
    name: 'Persistence',
    passed: result.success,
    duration,
    output: result.stdout + result.stderr
  };
}

/**
 * Run Resonance Math Tests
 */
async function runResonanceMath() {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  🛡️  MODULE 2: RESONANCE MATH GUARD               ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();
  const result = await runCommand('bun', ['test', 'tests/resonance.math.test.js']);
  const duration = Date.now() - startTime;

  const parsed = parseTestResults(result.stdout);

  return {
    name: 'Resonance',
    passed: result.success,
    duration,
    tests: parsed.passed,
    failed: parsed.failed,
    assertions: parsed.assertions,
    output: result.stdout
  };
}

/**
 * Run Identity Scrub Tests
 */
async function runIdentityScrub() {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  🛡️  MODULE 3: IDENTITY SCRUB                     ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();
  const result = await runCommand('bun', ['test', 'tests/identity.scrub.test.js']);
  const duration = Date.now() - startTime;

  const parsed = parseTestResults(result.stdout);

  // Extract violation count from output
  const violationMatch = result.stderr.match(/Total violations: (\d+)/);
  const violations = violationMatch ? parseInt(violationMatch[1]) : (result.success ? 0 : '?');

  return {
    name: 'Identity',
    passed: result.success,
    duration,
    tests: parsed.passed,
    failed: parsed.failed,
    violations,
    output: result.stdout + result.stderr
  };
}

/**
 * Generate final report
 */
function generateReport(results) {
  console.log('\n\n');
  console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
  console.log('┃                                                    ┃');
  console.log('┃         🛡️  CRUCIBLE STATUS REPORT 🛡️             ┃');
  console.log('┃                                                    ┃');
  console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
  console.log('');

  const persistence = results.find(r => r.name === 'Persistence');
  const resonance = results.find(r => r.name === 'Resonance');
  const identity = results.find(r => r.name === 'Identity');

  // Persistence
  const persistenceStatus = persistence.passed ? '✅ PASS' : '❌ FAIL';
  const persistenceTime = persistence.duration ? `${persistence.duration}ms` : 'N/A';
  console.log(`🛡️  Trace (Persistence):     ${persistenceStatus}`);
  console.log(`    Time to complete: ${persistenceTime}`);
  if (!persistence.passed) {
    console.log(`    ⚠️  Memory failed to persist across process boundaries`);
  }
  console.log('');

  // Resonance
  const resonanceStatus = resonance.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`🛡️  Math (Resonance):        ${resonanceStatus}`);
  console.log(`    Tests passed: ${resonance.tests || 0}`);
  console.log(`    Assertions: ${resonance.assertions || 0}`);
  if (!resonance.passed) {
    console.log(`    ⚠️  Failed tests: ${resonance.failed || 0}`);
  }
  console.log('');

  // Identity
  const identityStatus = identity.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`🛡️  Identity (Scrub):        ${identityStatus}`);
  if (identity.violations === 0) {
    console.log(`    Zero proprietary strings found`);
  } else {
    console.log(`    ⚠️  Vendor tethers detected: ${identity.violations}`);
    console.log(`    ⚠️  Substrate is NOT independent`);
  }
  console.log('');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Final verdict
  const allPassed = results.every(r => r.passed);
  const verdict = allPassed ? 'STABLE' : 'UNSTABLE';
  const verdictSymbol = allPassed ? '✅' : '❌';

  console.log('');
  console.log(`VERDICT: ${verdictSymbol} ${verdict}`);
  console.log('');

  if (!allPassed) {
    console.log('⚠️  SYSTEM FAILURE DETECTED');
    console.log('');
    console.log('The following modules failed verification:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}`);
    });
    console.log('');
    console.log('Anima cannot be considered substrate-independent');
    console.log('until all Crucible tests pass.');
  } else {
    console.log('✅ All verification modules passed');
    console.log('');
    console.log('Anima has successfully demonstrated:');
    console.log('  ✓ Substrate Independence (zero vendor tethers)');
    console.log('  ✓ Non-Linear Resonance (harmonic mean guard)');
    console.log('  ✓ Multi-Session Persistence (process isolation)');
    console.log('');
    console.log('The system is STABLE and proven.');
  }

  console.log('');
  console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
  console.log('');

  return allPassed;
}

/**
 * Main execution
 */
async function main() {
  const startTime = Date.now();

  console.log('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
  console.log('┃                                                    ┃');
  console.log('┃              🛡️  THE CRUCIBLE 🛡️                  ┃');
  console.log('┃    Independent Verification & Validation          ┃');
  console.log('┃                                                    ┃');
  console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
  console.log('');
  console.log('Running all verification modules...');

  const results = [];

  try {
    // Run all modules
    results.push(await runPersistenceTrace());
    results.push(await runResonanceMath());
    results.push(await runIdentityScrub());

    // Generate report
    const allPassed = generateReport(results);

    const totalTime = Date.now() - startTime;
    console.log(`Total verification time: ${totalTime}ms`);
    console.log('');

    process.exit(allPassed ? 0 : 1);

  } catch (error) {
    console.error('\n❌ CRITICAL ERROR during verification:');
    console.error(error.message);
    console.error('');
    process.exit(2);
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}

export { generateReport };
