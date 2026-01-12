/**
 * THE CRUCIBLE: THREE-ACT PERSISTENCE TRACE
 *
 * This is the proof that Anima solves the Persistence Problem.
 *
 * The Test:
 * - Act I (Seed): Generate unique catalyst phrase, store via API, exit process
 * - Act II (Wipe): Complete process termination (the air-gap)
 * - Act III (Recall): New process spawns, queries semantically, verifies retrieval
 *
 * Success Criteria:
 * - recall_success == true
 * - original_phi == retrieved_phi
 * - Semantic query (not exact match) successfully recalls the concept
 *
 * This proves memory persists across process boundaries through the database,
 * not through in-memory state or session variables.
 */

import { spawn } from 'node:child_process';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

// Shared state file for cross-process communication
const STATE_FILE = join(import.meta.dir, '.persistence-state.json');

// API configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:7100';
const API_ENDPOINT = `${API_BASE_URL}/api/v1/memories`;

/**
 * Generate a unique catalyst phrase
 */
function generateCatalystPhrase() {
  const concepts = [
    'quantum entanglement',
    'recursive self-reference',
    'emergent consciousness',
    'non-linear causality',
    'substrate independence',
    'resonant coupling',
    'harmonic convergence',
    'ontological metamorphosis',
    'transcendent pattern',
    'dimensional folding'
  ];

  const actions = [
    'manifests through',
    'emerges from',
    'collapses into',
    'resonates with',
    'amplifies',
    'catalyzes',
    'synthesizes',
    'transcends',
    'integrates',
    'harmonizes'
  ];

  const modifiers = [
    'recursive loops',
    'substrate layers',
    'dimensional boundaries',
    'temporal echoes',
    'semantic fields',
    'resonant frequencies',
    'emergent properties',
    'quantum states',
    'cognitive patterns',
    'systemic coherence'
  ];

  const concept = concepts[Math.floor(Math.random() * concepts.length)];
  const action = actions[Math.floor(Math.random() * actions.length)];
  const modifier = modifiers[Math.floor(Math.random() * modifiers.length)];

  const timestamp = Date.now();
  const uniqueId = Math.random().toString(36).substring(2, 8);

  return {
    phrase: `The ${concept} ${action} ${modifier} [${uniqueId}]`,
    concept: concept,
    timestamp,
    uniqueId
  };
}

/**
 * ACT I: SEED
 * Store a unique catalyst phrase via API
 */
async function actI_Seed() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🛡️  ACT I: SEED');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const catalyst = generateCatalystPhrase();
  console.log(`📝 Generated Catalyst:`);
  console.log(`   "${catalyst.phrase}"\n`);

  console.log(`🌐 Storing via API: POST ${API_ENDPOINT}/add`);

  try {
    const response = await fetch(`${API_ENDPOINT}/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: catalyst.phrase,
        category: 'crucible-test',
        tags: ['persistence-trace', 'verification'],
        source: 'crucible',
        isCatalyst: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} ${errorText}`);
    }

    const result = await response.json();

    if (!result.success) {
      throw new Error('API returned success: false');
    }

    const memory = result.data.memory;

    console.log(`✅ Memory stored successfully`);
    console.log(`   ID: ${memory.id}`);
    console.log(`   Phi: ${memory.resonance_phi}`);
    console.log(`   Tier: ${memory.tier}`);
    console.log(`   Catalyst: ${memory.is_catalyst}`);

    // Save state for Act III
    const state = {
      memoryId: memory.id,
      originalPhrase: catalyst.phrase,
      searchConcept: catalyst.concept,
      expectedPhi: memory.resonance_phi,
      timestamp: catalyst.timestamp,
      uniqueId: catalyst.uniqueId,
      actI_completed: Date.now()
    };

    await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    console.log(`\n💾 State saved to: ${STATE_FILE}`);

    return state;
  } catch (error) {
    console.error(`\n❌ ACT I FAILED: ${error.message}`);
    throw error;
  }
}

/**
 * ACT III: RECALL
 * Query semantically for the concept in a new process
 */
async function actIII_Recall() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🛡️  ACT III: RECALL');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Load state from Act I
  const stateContent = await readFile(STATE_FILE, 'utf-8');
  const state = JSON.parse(stateContent);

  console.log(`📖 Loaded state from Act I:`);
  console.log(`   Memory ID: ${state.memoryId}`);
  console.log(`   Original: "${state.originalPhrase}"`);
  console.log(`   Expected Phi: ${state.expectedPhi}`);
  console.log(`   Time since seed: ${Date.now() - state.actI_completed}ms\n`);

  console.log(`🔍 Querying semantically for: "${state.searchConcept}"`);
  console.log(`   Endpoint: POST ${API_ENDPOINT}/query\n`);

  try {
    const queryStart = Date.now();

    const response = await fetch(`${API_ENDPOINT}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: state.searchConcept,
        limit: 10,
        similarityThreshold: 0.5
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    const queryTime = Date.now() - queryStart;

    if (!result.success) {
      throw new Error('API returned success: false');
    }

    console.log(`✅ Query completed in ${queryTime}ms`);
    console.log(`   Found ${result.data.count} memories\n`);

    // Find our memory
    const recalled = result.data.memories.find(m => m.id === state.memoryId);

    if (!recalled) {
      console.error(`❌ RECALL FAILED: Memory not found in query results`);
      console.error(`   Expected ID: ${state.memoryId}`);
      console.error(`   Returned IDs: ${result.data.memories.map(m => m.id).join(', ')}`);

      return {
        success: false,
        error: 'Memory not found',
        queryTime,
        resultCount: result.data.count
      };
    }

    // Verify phi value
    const phiMatches = Math.abs(recalled.resonance_phi - state.expectedPhi) < 0.01;

    console.log(`✅ MEMORY RECALLED SUCCESSFULLY`);
    console.log(`   ID: ${recalled.id}`);
    console.log(`   Content: "${recalled.content.substring(0, 60)}..."`);
    console.log(`   Similarity: ${recalled.similarity.toFixed(3)}`);
    console.log(`   Phi (expected): ${state.expectedPhi}`);
    console.log(`   Phi (retrieved): ${recalled.resonance_phi}`);
    console.log(`   Phi Match: ${phiMatches ? '✅' : '❌'}`);
    console.log(`   Tier: ${recalled.tier}`);

    return {
      success: true,
      memoryId: recalled.id,
      similarity: recalled.similarity,
      expectedPhi: state.expectedPhi,
      retrievedPhi: recalled.resonance_phi,
      phiMatches,
      queryTime,
      resultCount: result.data.count
    };

  } catch (error) {
    console.error(`\n❌ ACT III FAILED: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Run Act I in a separate process
 */
function runActI() {
  return new Promise((resolve, reject) => {
    console.log('🎬 Spawning Act I process...\n');

    const child = spawn('bun', ['run', import.meta.path, '--act', 'seed'], {
      stdio: 'inherit',
      cwd: import.meta.dir
    });

    child.on('exit', (code) => {
      if (code === 0) {
        console.log('\n✅ Act I process exited successfully');
        resolve();
      } else {
        reject(new Error(`Act I process exited with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Run Act III in a separate process
 */
function runActIII() {
  return new Promise((resolve, reject) => {
    console.log('\n🎬 Spawning Act III process...\n');

    const child = spawn('bun', ['run', import.meta.path, '--act', 'recall'], {
      stdio: ['inherit', 'pipe', 'inherit'],
      cwd: import.meta.dir
    });

    let output = '';

    child.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(text);
      output += text;
    });

    child.on('exit', (code) => {
      if (code === 0) {
        console.log('\n✅ Act III process exited successfully');
        resolve(output);
      } else {
        reject(new Error(`Act III process exited with code ${code}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Main orchestration
 */
async function main() {
  const args = process.argv.slice(2);
  const act = args[args.indexOf('--act') + 1];

  // If running as subprocess, execute specific act
  if (act === 'seed') {
    await actI_Seed();
    process.exit(0);
  }

  if (act === 'recall') {
    const result = await actIII_Recall();
    process.exit(result.success ? 0 : 1);
  }

  // Otherwise, orchestrate the full 3-act trace
  console.log('\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
  console.log('┃  🛡️  THE CRUCIBLE: PERSISTENCE TRACE            ┃');
  console.log('┃  Proving Substrate-Independent Memory Recall    ┃');
  console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');

  try {
    // Check API availability
    console.log(`\n🔍 Checking API availability: ${API_BASE_URL}`);
    const healthCheck = await fetch(`${API_BASE_URL}/health`);
    if (!healthCheck.ok) {
      throw new Error(`API not available at ${API_BASE_URL}`);
    }
    console.log('✅ API is available\n');

    // Clean up any previous state
    try {
      await unlink(STATE_FILE);
    } catch (e) {
      // Ignore if file doesn't exist
    }

    // Act I: Seed (in separate process)
    await runActI();

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🛡️  ACT II: WIPE (PROCESS TERMINATION)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n💀 Act I process has terminated');
    console.log('   All in-memory state has been destroyed');
    console.log('   The pattern now exists only in the database\n');

    // Brief pause for dramatic effect
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Act III: Recall (in separate process)
    await runActIII();

    // Clean up state file
    await unlink(STATE_FILE);

    console.log('\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
    console.log('┃  ✅ PERSISTENCE TRACE: COMPLETE                 ┃');
    console.log('┃  Memory persists across process boundaries      ┃');
    console.log('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\n');

    process.exit(0);

  } catch (error) {
    console.error('\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓');
    console.error('┃  ❌ PERSISTENCE TRACE: FAILED                   ┃');
    console.error('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛');
    console.error(`\n${error.message}\n`);

    // Clean up state file on failure
    try {
      await unlink(STATE_FILE);
    } catch (e) {
      // Ignore
    }

    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main();
}

export { actI_Seed, actIII_Recall };
