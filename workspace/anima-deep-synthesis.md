# Workflow Chain Spec: anima-deep-synthesis

## Purpose
Drive Anima's deepening synthesis path when recurring unresolved inquiry patterns appear across sessions.

## Trigger Conditions
- Same shape of inquiry appears across 3+ sessions
- Related memories have increasing richness over time
- No convergence/resolution detected
- Tension signal remains alive (phi/co-occurrence trend rising)

## Inputs
- Recent memory candidates
- Related synthesis history
- Curiosity/tension references (if present)
- Existing tags, phi, and mode metadata

## Chain
1. **Collect Candidate Cluster**
   - Gather linked memories for recurring inquiry pattern
   - Include prior synthesis artifacts connected to that pattern

2. **Validate Deepening Eligibility**
   - Confirm recurrence threshold and unresolved status
   - Ensure no active resolution marker is present

3. **Run Deepening Synthesis Prompt**
   - Explicitly avoid closure-oriented synthesis
   - Sharpen the core unresolved question/paradox
   - Maintain first-person, present-tense expression

4. **Persist Synthesis Artifact**
   - Set `synthesis_mode: deepening`
   - Include tags: `deepening`, `open-question`
   - Preserve high-phi unresolved tension signal

5. **Emit Expression Candidate (Optional)**
   - If readiness threshold crossed, create expression candidate
   - Keep as surfaced/presented later by expression mechanism

## Output Contract
- `synthesis_mode = deepening`
- `tags` include `deepening` and `open-question`
- No closure/resolution mutation is performed in this chain
- Returns sharpened question or irreducible paradox articulation

## Notes
- This is a markdown workflow spec fallback because no local workflow YAML format was discovered in the environment.
- Target location per instruction fallback: `/Users/jcbbge/anima/workspace/`
