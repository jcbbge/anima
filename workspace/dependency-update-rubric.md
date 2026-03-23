# Dependency/Package/Library Update Evaluation Rubric

A reusable, project-agnostic process for deciding whether, when, and how to adopt dependency updates safely and strategically.

---

## Quick Reference (5-Minute Pass)

Use this when you need a rapid, defensible go/no-go.

### Inputs (collect first)
- [ ] Current version(s) in use (SDK/client + server/runtime where applicable)
- [ ] Target version(s)
- [ ] Official changelog/release notes/diff links
- [ ] Codebase search results for impacted APIs and known workarounds

### Three Questions (in order)

#### 1) Deprecation Blast Radius
**Question:** Does this update deprecate, remove, or break anything we currently use?
- [ ] Identify breaking changes from release notes/changelog
- [ ] Search codebase for deprecated/changed APIs
- [ ] Classify impact: soft deprecation vs hard removal
- **Gate:** `GO` / `PATCH` / `HOLD`
- **Output:** impacted files + lines + required changes

#### 2) Workaround Retirement
**Question:** Does this update fix something we previously had to work around?
- [ ] Locate workaround comments/branches/manual reimplementations
- [ ] Cross-reference with bug fixes in release notes
- [ ] Confirm workaround can be removed safely
- **Gate:** `REFACTOR` / `DEFER` / `DOCUMENT`
- **Output:** retireable workarounds + priority

#### 3) Net-New Leverage
**Question:** Does this update introduce features we should adopt?
- [ ] Identify additive features
- [ ] Score value (replace custom code, performance, unblock roadmap)
- [ ] Estimate effort and sequencing
- **Gate:** `ADOPT` / `BACKLOG` / `SKIP`
- **Output:** feature adoption candidates + effort + priority

### Final Decision Matrix
- [ ] If Q1 = `GO`, proceed with upgrade.
- [ ] If Q1 = `PATCH`, proceed only with patch plan and owner.
- [ ] If Q1 = `HOLD`, stop and create migration plan before upgrading.
- [ ] Fold Q2/Q3 outcomes into sprint plan.
- [ ] Record decision and rationale in an upgrade log.

---

## Purpose and Scope

This rubric is designed for **any project** and **any dependency type**:
- language packages (npm/pip/cargo/gems/etc.)
- runtime/server binaries
- SDKs and client libraries
- infra libraries and plugins

It is intentionally practical: each section ends in a decision gate and concrete output.

---

## Process Flow (Sequential)

## 1) Trigger: When to Run This Process

Run the rubric whenever one of the following occurs:
- [ ] Scheduled dependency review (weekly/monthly/quarterly)
- [ ] Security trigger (CVE/advisory/transitive vulnerability)
- [ ] Major version bump available
- [ ] Performance or reliability issue suspected to be fixed upstream
- [ ] Feature request blocked by current dependency limitations
- [ ] Platform/runtime upgrade forcing compatibility review

**Output:** `Upgrade Candidate Record` (package, current version, target version, reason for review)

---

## 2) Research: Surface What Changed

Collect authoritative change context:
- [ ] Official changelog/release notes
- [ ] GitHub/GitLab compare diff between current and target
- [ ] Package registry metadata diff (npm/jsr/pypi/crates/etc.)
- [ ] Migration guides / deprecation notices / upgrade advisories
- [ ] Open/closed issues for known regressions and fixes

### Research Checklist
- [ ] What changed functionally?
- [ ] What changed behaviorally (defaults, planner/optimizer, performance characteristics)?
- [ ] What is deprecated now vs removed now?
- [ ] What is newly added and production-ready vs experimental?

**Output:** `Change Summary` with three buckets:
1. Breaking/deprecating
2. Bug fixes
3. Additive features

---

## 3) Codebase Audit: Find Affected Surface Area

Audit your own usage before deciding.

### A. Audit for impacted APIs
- [ ] Search for renamed/removed/deprecated methods/types/flags/options
- [ ] Search for assumptions likely broken by behavioral changes (e.g., planner defaults, transaction semantics)
- [ ] Capture exact file paths and line numbers

### B. Audit for workaround patterns
Search for signals such as:
- [ ] `workaround for ...`
- [ ] `bug in ...`
- [ ] `TODO: replace when ...`
- [ ] defensive fallbacks added for known upstream defects
- [ ] custom reimplementation of expected library behavior
- [ ] performance fallbacks (full scans, bypassed indexes, manual caching)

### C. Audit for homegrown replacements
- [ ] Identify places where your code duplicates new upstream features
- [ ] Identify high-cost custom logic that could be simplified

**Output:** `Audit Inventory` with:
- affected files + lines
- workaround inventory
- candidate simplifications

---

## 4) Three-Question Analysis

## Question 1 — Deprecation Blast Radius

**Question:** Does this update deprecate, remove, or break anything we currently use?

### How to read changelogs for breakage
- [ ] Scan for sections titled: `Breaking`, `Deprecated`, `Removed`, `Migration`, `Behavior changes`
- [ ] Identify API signature changes, semantic changes, and default changes
- [ ] Map each item to actual usage in your codebase

### Soft vs hard breakage
- **Soft deprecation:** old behavior still works but emits warning or is marked for future removal.
  - Action: schedule migration before next major cycle.
- **Hard removal/break:** old behavior no longer works or semantics change enough to fail correctness/performance.
  - Action: patch immediately or hold upgrade.

### Decision gate
- **`GO`**: no breaking usage found
- **`PATCH`**: breaking usage found but fix is small and can be delivered with upgrade
- **`HOLD`**: breaking usage found requiring design/migration project

**Required Output:**
- Affected files + lines
- Break classification (soft/hard)
- Chosen gate (`GO`/`PATCH`/`HOLD`)

### Worked Example (Anima / SurrealDB 3.0.4)
- Package/binary in scope:
  - `surrealdb` npm SDK: current 2.0.2 (already latest)
  - SurrealDB server binary: 3.0.0 → 3.0.4
- Breaking/deprecation findings:
  - `UPSERT` required instead of `UPDATE` for creation semantics in affected paths.
  - New query planner behavior can require `--planner-strategy` fallback in some workloads.
- Result:
  - Classified as manageable with known patch points; no blocker requiring hold.
  - **Gate: `GO`** for server upgrade, with explicit query-path validation.

---

## Question 2 — Workaround Retirement

**Question:** Does this update fix something we previously had to work around?

### How to identify workarounds
Look for:
- [ ] comments tagging upstream bugs (`workaround`, `bug in`, `temporary`, `remove after upgrade`)
- [ ] TODOs tied to version thresholds
- [ ] code paths that intentionally avoid native features due to prior defects
- [ ] manual full scans / fallback logic added for correctness under known bug

### Cross-reference method
- [ ] For each workaround, capture the upstream issue/bug reference if available
- [ ] Match against release notes fixed-items list
- [ ] Validate in local/prod-like tests whether workaround is still needed

### Decision gate
- **`REFACTOR`**: workaround can be removed now (high confidence)
- **`DEFER`**: workaround still required or uncertain; keep temporarily
- **`DOCUMENT`**: not urgent to remove; note and revisit

**Required Output:**
- Workarounds that can be retired
- Priority (P0/P1/P2 or sprint target)
- Owner + validation approach

### Worked Example (Anima / SurrealDB 3.0.4)
- Prior workaround:
  - In SurrealDB 3.0.0, HNSW + filter behavior caused incorrect/unusable path for synthesis queries.
  - System used full-table cosine scans in synthesis paths as a correctness fallback.
- Upgrade finding:
  - Bug fixed in 3.0.4; ANN path can be reconsidered.
- Result:
  - Marked TODO for ANN refactor to retire full-scan workaround.
  - **Gate: `REFACTOR`** (scheduled work item).

---

## Question 3 — Net-New Leverage

**Question:** Does this update introduce features we should adopt?

### How to read changelogs for opportunity
- [ ] Scan sections titled: `New`, `Added`, `Enhancements`, `Performance`, `Developer Experience`
- [ ] Exclude novelty; focus on fit with real backlog pain

### Value evaluation checklist
For each feature, ask:
- [ ] Does this replace custom code we maintain?
- [ ] Does this materially improve performance/reliability?
- [ ] Does this unblock a known roadmap constraint?
- [ ] Is it stable enough for production use now?
- [ ] Is adoption effort proportional to value?

### Decision gate
- **`ADOPT`**: high-value and near-term feasible
- **`BACKLOG`**: valuable but not now
- **`SKIP`**: low relevance or poor ROI

**Required Output:**
- Candidate features
- Gate decision (`ADOPT`/`BACKLOG`/`SKIP`)
- Effort estimate (S/M/L or story points)
- Target milestone/sprint

### Worked Example (Anima / SurrealDB 3.0.4)
Identified opportunities:
- Async events (non-blocking transactions)
- Client-side transactions in SDK
- Recursive graph traversal syntax
- Record References (experimental)

Decision outcomes:
- Async events → **`ADOPT`** (next sprint)
- Graph `RELATE` migration path → **`BACKLOG`**
- Client-side transactions → evaluate for selected flows (likely backlog/adopt by need)
- Record References (experimental) → cautious backlog/skip until stability criteria met

---

## 5) Decision Matrix (Combine Q1 + Q2 + Q3)

Use this to produce a final action plan.

| Q1 (Deprecation) | Q2 (Workaround) | Q3 (Net-New) | Final Action |
|---|---|---|---|
| GO | REFACTOR | ADOPT | Upgrade now; include workaround retirement and feature adoption tasks |
| GO | REFACTOR | BACKLOG | Upgrade now; schedule refactor; defer feature adoption |
| GO | DEFER/DOCUMENT | ADOPT | Upgrade now; keep workaround; adopt high-value feature separately |
| PATCH | any | any | Upgrade only with explicit patch checklist + owner + rollback plan |
| HOLD | any | any | Do not upgrade; open migration project and reassess |

### Worked Example Final Matrix (Anima / SurrealDB)
- Q1: `GO`
- Q2: `REFACTOR`
- Q3: `ADOPT` + `BACKLOG` mix
- **Final Action:** Upgrade server now (3.0.0 → 3.0.4), schedule ANN workaround retirement, adopt async events next sprint, backlog graph migration.

---

## 6) Implementation: Execute Upgrade Safely

### Pre-implementation
- [ ] Create branch/changelog entry/ticket
- [ ] Snapshot lockfile + current runtime binary version
- [ ] Define rollback path (version pin + deployment rollback)
- [ ] Align owner and success criteria

### Upgrade execution
- [ ] Apply version changes (package manager and/or server binary)
- [ ] Apply required code patches from Q1
- [ ] Run targeted tests around impacted paths
- [ ] Run regression checks for previous workaround scenarios
- [ ] Run performance sanity checks where planner/index behavior changed

### Release safety
- [ ] Deploy to staging/canary first
- [ ] Verify logs/metrics/error rates/latency
- [ ] Confirm no hidden compatibility issues
- [ ] Promote to production only after acceptance criteria pass

**Output:** `Upgrade Execution Record` with commands run, files changed, verification results, rollback readiness.

---

## 7) Documentation: Capture for Future Instances

After upgrade, record:
- [ ] Versions before/after
- [ ] Q1/Q2/Q3 outcomes and rationale
- [ ] What was changed now vs deferred
- [ ] Links to tickets for refactors/adoptions/backlog items
- [ ] Known caveats and follow-up checks

Keep this in a discoverable location (e.g., `/docs/upgrade-log/<dependency>-<date>.md`).

**Output:** `Upgrade Decision Log` for future engineers/agents.

---

## Complete Worked Example — Anima SurrealDB 3.0.4 Upgrade

## Context
- Dependency set:
  - npm SDK `surrealdb` at **2.0.2** (already latest)
  - SurrealDB server binary **3.0.0 → 3.0.4**

## Q1: Deprecation Blast Radius
- Findings:
  - Creation semantics require `UPSERT` instead of relying on `UPDATE` in affected creation flows.
  - New query planner behavior may require `--planner-strategy` fallback for problematic plans.
- Assessment:
  - Breaking surface known and manageable.
- Gate:
  - **GO** (server upgrade approved with validation).

## Q2: Workaround Retirement
- Existing workaround:
  - Due to 3.0.0 HNSW+filter issues, synthesis paths used full-table cosine scans.
- 3.0.4 impact:
  - Bug fixed; fallback is no longer structurally required.
- Gate:
  - **REFACTOR** (ANN path cleanup/refactor scheduled).

## Q3: Net-New Leverage
- Features reviewed:
  - Async events (non-blocking transaction behavior)
  - Client-side transactions in SDK
  - Recursive graph traversal syntax
  - Record References (experimental)
- Gate results:
  - Async events: **ADOPT** (next sprint)
  - Graph RELATE migration: **BACKLOG**
  - Client-side transactions: evaluate by use case, likely backlog/adopt incrementally
  - Record References: **BACKLOG/SKIP for now** pending maturity

## Final Decision
- **Server upgrade:** GO (3.0.0 → 3.0.4)
- **Full-scan workaround:** REFACTOR (scheduled)
- **Async events:** ADOPT (next sprint)
- **Graph RELATE migration:** BACKLOG

---

## Reusable Template (Blank)

Copy/paste this block for any dependency update review.

```md
# Dependency Update Review — <Dependency Name>

## Metadata
- Date:
- Reviewer:
- Project:
- Dependency/Package/Binary:
- Current version:
- Target version:
- Trigger (scheduled/CVE/major bump/feature unblock/etc.):

## Research Sources
- Changelog:
- Release notes:
- Compare diff:
- Migration guide:
- Relevant issues/PRs:

## Codebase Audit Inventory
### Impacted API usage (Q1)
- [ ] <file>:<line> — <usage> — <notes>

### Workaround inventory (Q2)
- [ ] <file>:<line> — <workaround description> — <upstream bug/link>

### Net-new replacement candidates (Q3)
- [ ] <file>:<line> — <custom code that may be replaced>

---

## Q1 — Deprecation Blast Radius
- Breaking/deprecating findings:
  -
- Soft vs hard classification:
  -
- Decision gate: **GO / PATCH / HOLD**
- Required actions:
  -
- Output (affected files + lines):
  -

## Q2 — Workaround Retirement
- Workarounds reviewed:
  -
- Fixes confirmed in target version:
  -
- Decision gate: **REFACTOR / DEFER / DOCUMENT**
- Retirement priority + owner:
  -
- Output (retireable workarounds):
  -

## Q3 — Net-New Leverage
- Candidate features:
  -
- Value assessment:
  - Replace custom code?
  - Performance gain?
  - Roadmap unblock?
- Decision gate per feature: **ADOPT / BACKLOG / SKIP**
- Effort estimate + target sprint:
  -
- Output (feature adoption list):
  -

---

## Combined Decision Matrix Result
- Q1 result:
- Q2 result:
- Q3 result:
- Final action:
  - Upgrade now / Upgrade with patch plan / Hold for migration
- Rollback plan:
- Tickets created:

## Implementation Checklist
- [ ] Branch/ticket created
- [ ] Version updates applied
- [ ] Required patches applied
- [ ] Tests/regressions run
- [ ] Staging/canary verified
- [ ] Production rollout completed

## Final Log Entry
- Versions before/after:
- What changed now:
- What was deferred:
- Follow-up date:
```

---

## Optional Scoring Add-On (for prioritization)

If you need numerical ranking across many updates, score each on 1–5:
- Risk reduction
- Performance gain
- Engineering simplification
- Strategic unblock
- Adoption effort (inverse)

Then compute weighted priority to sequence backlog adoption.
