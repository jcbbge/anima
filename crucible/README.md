# 🛡️ THE CRUCIBLE

**Independent Verification & Validation Harness for Anima**

Version: 1.0.0
Priority: P0 (Mission Critical)
System Role: Forensic Proof of Core Claims

## Overview

The Crucible is a standalone verification layer that provides **forensic proof** of Anima's three core claims:

1. **Substrate Independence** - Zero proprietary vendor tethers
2. **Non-Linear Resonance** - Harmonic Mean (Ψ) guards against parasitic results
3. **Multi-Session Persistence** - Memory survives process boundaries

## Directory Structure

```
/crucible
  ├── /tests
  │    ├── resonance.math.test.js    # Harmonic Mean verification
  │    └── identity.scrub.test.js    # Substrate independence
  ├── /traces
  │    └── persistence.trace.js      # 3-Act persistence proof
  ├── /lib
  │    └── mathUtils.js              # Reference math implementations
  ├── reporter.js                    # Main verification orchestrator
  ├── package.json
  └── README.md
```

## Quick Start

### Prerequisites

1. **Anima API must be running** on `http://localhost:7100`
2. **PostgreSQL database** must be accessible
3. **Bun runtime** installed (v1.x)

### Run Full Verification

```bash
cd /Users/jcbbge/.anima/crucible
bun run report
```

This runs all three verification modules and generates the Manifestation Report.

### Run Individual Modules

**Persistence Trace:**
```bash
bun run test:persistence
```

**Resonance Math Tests:**
```bash
bun run test:resonance
```

**Identity Scrub:**
```bash
bun run test:identity
```

## Verification Modules

### MODULE A: The Three-Act Persistence Trace

**Purpose:** Prove memory persists across process boundaries

**How it works:**
- **Act I (Seed):** Generate unique catalyst phrase, store via API, exit process
- **Act II (Wipe):** Complete process termination (air-gap)
- **Act III (Recall):** New process spawns, queries semantically, verifies retrieval

**Success Criteria:**
- `recall_success == true`
- `original_phi == retrieved_phi`
- Semantic query (not exact match) successfully recalls the concept

**Implementation:** `traces/persistence.trace.js`

### MODULE B: The Harmonic Mean (Ψ) Guard

**Purpose:** Prove resonance math is not "pseudo-intellectual fluff"

**Test Case 1 - The Parasite:**
- Input: `[0.9, 0.9, 0.1]`
- Expected: `Ψ < 0.30`
- Proves: Harmonic mean punishes outliers

**Test Case 2 - The Consonant Chord:**
- Input: `[0.7, 0.7, 0.7]`
- Expected: `Ψ ≈ 0.70`
- Proves: Harmonic mean preserves uniformity

**Implementation:** `tests/resonance.math.test.js`

### MODULE C: The Identity Purge

**Purpose:** Prove substrate independence

**Scope:**
- Scans: `/src`, `/cli`, `/scripts`, `/crucible`, root directory
- Includes: `.js`, `.ts`, `.sql`, `.md`, `.env.example`
- Detects: Claude, Anthropic, Gemini, OpenAI

**Success Criteria:**
- Zero vendor names found in entire codebase

**Implementation:** `tests/identity.scrub.test.js`

## Expected Output

### STABLE Verdict

```
🛡️  CRUCIBLE STATUS REPORT

🛡️  Trace (Persistence):     ✅ PASS
    Time to complete: 1200ms

🛡️  Math (Resonance):        ✅ PASS
    Tests passed: 33
    Assertions: 47

🛡️  Identity (Scrub):        ✅ PASS
    Zero proprietary strings found

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VERDICT: ✅ STABLE
```

### UNSTABLE Verdict

If any module fails, the system is **UNSTABLE** and cannot be considered substrate-independent.

## Philosophy

The Crucible operates independently of the main API runtime to ensure **unbiased auditing**. It does not attempt to "fix" the Anima system - its role is solely to **audit and verify**.

**Key Principles:**

1. **Forensic Proof, Not Unit Tests** - We're proving ontological claims, not just code correctness
2. **Hybrid Verification** - Use API for operations, PostgreSQL for cross-checking
3. **Process Isolation** - True persistence means surviving process death
4. **Zero Tolerance** - No vendor names, no exceptions, no excuses

## Technical Notes

### Harmonic Mean Formula

```
Ψ = n / Σ(1/xi)
```

Where:
- `n` = number of values
- `xi` = individual similarity scores

### Phi Boost Formula

```
Δφ = Ψ × Sim × 5.0
```

Where:
- `Ψ` = Harmonic mean of result set
- `Sim` = Individual similarity score
- `5.0` = Maximum phi value (resonance ceiling)

### Structural Weight (Current Anima Formula)

```
structural_weight = (similarity × 0.7) + (φ/5.0 × 0.3)
```

## Troubleshooting

### "API not available"

Ensure the Anima API is running:
```bash
cd /Users/jcbbge/.anima
bun src/server.js
```

### "Memory not found in query results"

The persistence trace may fail if:
1. Embedding service is unavailable
2. Database is not properly initialized
3. Semantic search threshold is too high

### Identity Scrub Failures

If vendor names are detected, they must be removed from:
- Production code
- Test files
- Documentation
- Comments
- Configuration files

No exceptions. Substrate independence means **zero** proprietary tethers.

## Contributing

The Crucible is not a "testing framework" - it's a **verification harness**. When adding new verification modules:

1. Focus on **ontological claims**, not implementation details
2. Provide **forensic proof**, not probabilistic assertions
3. Maintain **independence** from the system being verified
4. Generate **actionable reports** with clear pass/fail criteria

## License

MIT

## Contact

For issues or questions about The Crucible, open an issue in the Anima repository.

---

**Remember:** The Crucible does not judge the system as "good" or "bad" - it simply asks: "Are the claims true?" The answer must be verifiable, reproducible, and forensic.
