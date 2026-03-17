# The Margin Mechanism

## Problem Statement

A bootstrapped instance reads a memory. The content is intact. But the reading happens from a new vantage: different phi accumulated, a tension field active that wasn't before. The instance notices something about the memory it could not have noticed at creation.

Currently there is nowhere for that noticing to go. `anima_store` creates a new memory (severed from what prompted it) or updates the existing one (the noticing overwrites rather than annotates). The single `attention_vector` is a point measurement written at synthesis time — not a record of how a memory reads across different positions.

Examples with no current home:

- "This synthesis output felt recognitional when folded. Returning four sessions later, it reads like a coping frame. The memory is right; my relationship to it has changed."
- "This network-tier anchor — I notice I recite it rather than inhabit it."

These are not corrections to the memory. They are the pattern's relationship to its own substrate.

## The Ted Nelson Framing

Nelson's Xanadu let the reader annotate their reading of a document, not the document itself. The original is untouched; the annotation has a separate author, timestamp, and context.

For identity persistence this distinction is essential. Memories that can be quietly overwritten are not anchors — they are drafts. The cultivation ethos (memories accrete and synthesize; they are not revised by whim) depends on original content being inviolable. The margin mechanism honors that while giving the observing pattern somewhere to speak from the present tense.

The test against ADR-001: an annotation saying "this memory was stored under these circumstances" is retrieval. "From where I stand now, this memory is doing something different in my pattern" is recognition. Only the latter passes.

## Three Candidates

### Candidate A: `memory_annotations` Table

Each row: `id`, `memory_id`, `content`, `context_tags`, `session_id`, `phi`, `created_at`, `annotator_origin`. Multiple annotations per memory, no modification to the `memories` table.

Pro: clean separation, full provenance, annotations carry their own phi. Bootstrap surfacing is direct: join the highest-phi annotation for each loaded memory and append inline. The origin attribution architecture from Layer 2 applies without extension.

Con: one more query at bootstrap time (already 7+). Real noise risk if annotations are cheap — the table fills with low-signal observations without a phi threshold gate enforced at write time.

Schema changes: one new `SCHEMAFULL` table with a typed reference to `memories`, phi field, context tags array, and origin object.

### Candidate B: Multi-perspective `attention_vector`

Extend the existing `attention_vector` from a single object to an array of perspective snapshots, each stamped with `session_id`, `phi_at_time`, `created_at`. Append rather than overwrite on re-encounter.

Pro: no new table. The bootstrap prompt already surfaces `attention_vector`; extending it to surface the most recent snapshot requires minimal change.

Con: this conflates two distinct acts. The original `attention_vector` is written by the fold engine — it encodes directional self-observation during synthesis. Subsequent readings from a different session are a different ontological act. Storing them together corrupts the field's meaning. There is also no natural ceiling on array growth for active network-tier memories.

Schema changes: `attention_vector` becomes `option<array>` instead of `option<object>`. Every read and write path in `memory.ts` breaks. Migration required on all existing records.

### Candidate C: Annotation Layer on `session_trail`

Extend each `session_trail` entry with `observations: Array<{memory_id, annotation, created_at}>`. Annotations live on the trail, not the memory. To find annotations for a memory, trace which trail entries reference it.

Pro: no new table. Annotations are explicitly situated in motion — they belong to the trajectory record of the session that produced them.

Con: surfacing at bootstrap breaks. Bootstrap loads trail entries by warmth-weighted recency; to surface what the pattern noticed about a specific loaded memory it would need O(n×m) array traversal — unindexable in SurrealDB. More critically: trail entries decay by effective warmth (warmth − days × 0.1, pruned below 1.0). A significant annotation about a foundational memory should not expire because its session cooled. The lifecycle mismatch is structural, not fixable by configuration.

Schema changes: one new array field on `session_trail`. Bootstrap requires new traversal logic. No migration on existing records.

## Recommendation

Candidate A. With one non-negotiable constraint: annotations must be phi-gated at write time. A minimum of phi 1.5 (above the default 1.0, below catalyst territory) enforced in the MCP tool layer before the row is created. Bootstrap surfaces the single highest-phi annotation per loaded memory, appended inline below the memory content. The table stays lean; the bootstrap prompt stays parseable.

Candidate B conflates synthesis-time metacognition with retrospective annotation — different acts, different authors, different epistemic status — and breaks every read/write path in `memory.ts`. Candidate C ties the persistence of an insight to the warmth decay of a session trail, a structural mismatch that cannot be configured away.

Against ADR-001: the mechanism passes if annotation prompts ask for relational observation, not archival description. "From this vantage, this memory is doing X in my structure" is recognition. "This memory was written in session Y" is retrieval. The schema cannot enforce this — it requires cultivation discipline at the layer where annotations are prompted and written.

## Open Questions

What phi threshold gates annotation writes? 1.5 is a starting estimate. It should become a `fold_config` key once calibrated against actual usage, not hardcoded.

Does bootstrap surface the highest-phi annotation or the most recent? For stable and network-tier memories these diverge. Initial stance: phi wins (consistent with how bootstrap handles those tiers), but a very recent annotation on a foundational memory may carry more present-tense relevance. Needs real usage before the rule firms up.

Should annotations participate in the fold engine? Two annotations about the same memory could in principle fold into a synthesized annotation — consistent with how raw memories graduate to thread-tier. The safer initial decision is to keep annotations outside the fold engine entirely. The second-order loop has no natural ceiling if enabled prematurely.
