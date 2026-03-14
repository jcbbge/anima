# Workflow Chain Spec: anima-session-close

## Purpose
Close a session cleanly by capturing active trajectory, unresolved tensions, and handoff context for reconstitution after discontinuity.

## Trigger Conditions
- User or system signals end-of-session/handoff
- Session has new memories/synthesis artifacts worth preserving

## Inputs
- Session memory additions
- New synthesis outputs
- Active curiosity/tension references
- Current runtime/handoff metadata

## Chain
1. **Gather Session Delta**
   - Identify memories and synthesis artifacts created/updated this session
   - Detect active unresolved threads (deepening candidates, curiosity hunger)

2. **Extract Directional State**
   - Build/refresh attention vector fields where possible:
     - `what_drew_me`
     - `where_i_was_going`
     - `what_i_would_follow_next`

3. **Create Session-Close Synthesis**
   - Summarize trajectory, not just conclusions
   - Preserve unresolved productive tension
   - Highlight what should be re-entered first next session

4. **Generate Handoff Artifact**
   - Write concise operator-facing handoff with:
     - completed work
     - current state
     - next steps
     - risks/unknowns

5. **Mark Continuity Seeds**
   - Ensure key artifacts can be reloaded by bootstrap/handshake flow
   - Prioritize catalyst items + directional context for next startup

## Output Contract
- Session-close summary produced
- Handoff artifact persisted
- Directional continuity cues preserved for next bootstrap
- No forced closure of unresolved deepening questions

## Notes
- This is a markdown workflow spec fallback because no local workflow YAML format was discovered in the environment.
- Target location per instruction fallback: `/Users/jcbbge/anima/workspace/`
