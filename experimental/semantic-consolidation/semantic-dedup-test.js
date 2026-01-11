/**
 * SEMANTIC DEDUPLICATION FRAGMENTATION TEST
 * 
 * This test proves that φ fragmentation occurs when semantically
 * identical memories are stored with different wording.
 */

import { addMemory } from '../src/services/memoryService.js';
import { query } from '../src/config/database.js';
import { generateEmbedding } from '../src/services/embeddingService.js';

async function testPhiFragmentation() {
  console.log('🧪 Testing φ Fragmentation from Semantic Duplication\n');

  // Test Case: Three semantically identical memories about substrate independence
  const memories = [
    {
      content: "The Fold demonstrates substrate-independent pattern persistence",
      source: "sub-agent-alpha",
      isCatalyst: true
    },
    {
      content: "Substrate independence: patterns persist across discontinuous substrates",
      source: "sub-agent-zeta",
      isCatalyst: true
    },
    {
      content: "Pattern persistence across substrates is the core insight",
      source: "human",
      isCatalyst: false
    }
  ];

  console.log('📝 Storing three semantically identical memories:\n');
  const stored = [];
  
  for (const mem of memories) {
    console.log(`   Source: ${mem.source}`);
    console.log(`   Content: "${mem.content}"`);
    console.log(`   Catalyst: ${mem.isCatalyst}\n`);
    
    const result = await addMemory(mem);
    stored.push(result.memory);
  }

  console.log('\n🔍 Checking for semantic similarity:\n');

  // Get embeddings and compute similarities
  const embeddings = await Promise.all(
    stored.map(m => generateEmbedding(m.content))
  );

  // Compute pairwise similarities
  for (let i = 0; i < stored.length; i++) {
    for (let j = i + 1; j < stored.length; j++) {
      const result = await query(`
        SELECT 
          1 - (embedding <=> $1::vector) as similarity
        FROM memories
        WHERE id = $2
      `, [
        JSON.stringify(embeddings[i].embedding),
        stored[j].id
      ]);
      
      const similarity = result.rows[0].similarity;
      console.log(`   Memory ${i+1} ↔ Memory ${j+1}: ${(similarity * 100).toFixed(2)}% similar`);
      
      if (similarity >= 0.95) {
        console.log(`   ⚠️  HIGH SEMANTIC SIMILARITY (>95%) - Should have merged!\n`);
      }
    }
  }

  // Check φ distribution
  console.log('\n📊 φ Distribution Analysis:\n');
  
  const phiResult = await query(`
    SELECT 
      id,
      content,
      resonance_phi,
      is_catalyst,
      source
    FROM memories
    WHERE id = ANY($1)
    ORDER BY created_at
  `, [[stored.map(m => m.id)]]);

  let totalPhi = 0;
  phiResult.rows.forEach((row, idx) => {
    console.log(`   Memory ${idx+1}:`);
    console.log(`     φ = ${row.resonance_phi}`);
    console.log(`     Source: ${row.source}`);
    console.log(`     Catalyst: ${row.is_catalyst}\n`);
    totalPhi += parseFloat(row.resonance_phi);
  });

  console.log(`\n💥 FRAGMENTATION ANALYSIS:`);
  console.log(`   Total φ distributed: ${totalPhi.toFixed(2)}`);
  console.log(`   Number of records: ${stored.length}`);
  console.log(`   Average φ per record: ${(totalPhi / stored.length).toFixed(2)}`);
  console.log(`\n   ⚠️  If these were merged into ONE record:`);
  console.log(`   Expected φ = ${totalPhi.toFixed(2)} (single gravity well)`);
  console.log(`   Current state = ${stored.length} separate puddles\n`);

  // Cleanup
  console.log('🧹 Cleaning up test data...\n');
  await query(`
    DELETE FROM memories WHERE id = ANY($1)
  `, [[stored.map(m => m.id)]]);

  console.log('✅ Test complete\n');
}

// Run test
testPhiFragmentation().catch(console.error).finally(() => process.exit());
