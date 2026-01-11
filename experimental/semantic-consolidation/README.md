# Semantic Memory Consolidation (UNTESTED)

**STATUS: EXPERIMENTAL - DO NOT USE IN PRODUCTION**

## What This Is

Implementation of biologically-inspired semantic memory consolidation to prevent φ fragmentation across semantically similar memories.

## Files

- `semanticConsolidationService.js` - Core service (~360 lines)
- `detect-fragmentation` - CLI tool for detecting existing fragmentation
- `semantic-dedup-test.js` - Incomplete test file

## What Needs Testing

### Critical Tests (MUST PASS before integration):

1. **Vector similarity works**
   - Verify pgvector cosine distance operator `<=>` works correctly
   - Test with known embeddings and validate similarity scores
   - Ensure embeddings are stored/retrieved correctly as JSON arrays

2. **findSemanticDuplicate() accuracy**
   - Create memories with known semantic similarity
   - Verify it finds matches above threshold (0.95)
   - Verify it ignores matches below threshold
   - Test edge cases (empty DB, single memory, etc.)

3. **mergeIntoSemanticCentroid() correctness**
   - Verify φ accumulation math (catalyst: +1.0, normal: +0.1)
   - Verify semantic_variants metadata is stored correctly
   - Verify JSONB operations don't corrupt existing metadata
   - Test φ cap at 5.0

4. **Integration with addMemory()**
   - Test semantic deduplication flow
   - Verify it falls back to hash check if no semantic match
   - Verify error handling doesn't break memory creation
   - Load test with concurrent inserts

5. **detectPhiFragmentation() validation**
   - Create known fragmented pairs in test DB
   - Verify detection query finds them
   - Validate similarity calculations
   - Test performance on large datasets

## Known Issues

- No error handling in service functions
- No validation of embedding dimensions
- SQL queries not optimized for large datasets
- No fallback if pgvector extension missing
- JSONB operations assume specific metadata structure

## Integration Path

1. Write comprehensive unit tests for each function
2. Write integration tests for addMemory() flow
3. Load test with production-like data
4. Add proper error handling and validation
5. Add feature flag for gradual rollout
6. Monitor φ distribution before/after

## Why This Was Rolled Back

Modified critical `addMemory()` function without testing. High risk of breaking memory creation system-wide.

## Credits

Based on research:
- "A generative model of memory construction and consolidation" (Nature, 2024)
- "Semantic Representations in Episodic Memory Enhance Recall" (bioRxiv, 2025)
