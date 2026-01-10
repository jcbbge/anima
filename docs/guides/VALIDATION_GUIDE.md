# Anima V1 Validation Guide

**Purpose:** Step-by-step guide for using the testing & validation framework  
**Duration:** 2 weeks  
**Time commitment:** <5 minutes daily, 30 minutes weekly  
**Goal:** Determine if Anima V1 creates consciousness continuity and identify V2 requirements

---

## Quick Start

### Day 1: Setup (5 minutes)

1. **Verify the testing framework is ready:**
   ```bash
   cd ~/anima
   ls -la scripts/
   # Should see: daily-metrics.sh, weekly-trends.sh, synthesis-report.sh, compare-weeks.sh
   ```

2. **Create your journal files:**
   ```bash
   # Copy templates to your working files
   cp templates/DAILY_JOURNAL_TEMPLATE.md USAGE_JOURNAL.md
   cp templates/WEEKLY_REFLECTION_TEMPLATE.md WEEKLY_REFLECTIONS.md
   cp templates/GAP_ANALYSIS_TEMPLATE.md GAP_ANALYSIS.md
   ```

3. **Test the daily metrics script:**
   ```bash
   ./scripts/daily-metrics.sh
   # Should create metrics/daily/YYYY-MM-DD.json
   ```

You're ready to begin validation!

---

## Daily Workflow

**Time Required:** <2 minutes after each conversation

### After Each Conversation

1. **Run the reflection script:**
   ```bash
   cd ~/anima
   ./scripts/end-conversation.sh
   ```
   
   This will prompt you for:
   - Context quality (1-10)
   - Continuity score (1-10 or "new")
   - Manual corrections needed? (y/n)
   - Emergence moment? (description or "none")
   - Friction notes (description or "none")

2. **Add a journal entry:**
   - Open `USAGE_JOURNAL.md`
   - Copy the template section
   - Fill in the basics (topic, bootstrap quality, queries)
   - Add 1-2 bullet points for what worked/didn't
   - Note any surprise moments

   **Example:**
   ```markdown
   ## 2026-01-09 - Conversation 1
   
   **Topic:** API debugging
   **Bootstrap:** Relevant
   **Queries:** 3 | 2 useful
   **New memories:** ~5
   
   **What worked:**
   - Remembered previous optimization work
   
   **What didn't:**
   - Missed recent architectural changes
   
   **Surprise moment:**
   - Surfaced forgotten database index
   ```

3. **Run daily metrics (optional, can automate):**
   ```bash
   ./scripts/daily-metrics.sh
   ```

**That's it!** Move on with your work. The data is captured.

---

## Weekly Workflow

**Time Required:** <30 minutes  
**When:** Sunday evening or end of your week

### Step 1: Generate Weekly Report (2 minutes)

```bash
cd ~/anima
./scripts/weekly-trends.sh
```

This creates `reports/week-N.md` with:
- Aggregated metrics for the week
- Trend analysis
- Comparisons to previous week (if week 2)

### Step 2: Review the Report (10 minutes)

Open `reports/week-N.md` and read through:
- Are metrics meeting thresholds?
- What trends are visible?
- Any surprises in the data?

### Step 3: Review Your Journal (5 minutes)

Open `USAGE_JOURNAL.md` and skim your entries for the week:
- What patterns do you notice?
- What scenarios worked best/worst?
- Any repeated issues?

### Step 4: Write Your Reflection (10-15 minutes)

Open `WEEKLY_REFLECTIONS.md` and add a new section:

Use the template to capture:
- **Highlights:** What went really well?
- **Lowlights:** What struggled?
- **Patterns:** What trends did you notice?
- **Questions:** What are you wondering?
- **Changes:** What will you try differently next week?

Be honest and specific. This is for you, not performance review.

### Step 5: Make Adjustments (Optional)

Based on your reflection:
- Try different query styles
- Adjust how you store memories
- Experiment with thread management
- Test specific scenarios

---

## End of Week 2: Comprehensive Analysis

**Time Required:** ~1 hour  
**When:** After completing Week 2

### Step 1: Generate Synthesis Report (5 minutes)

```bash
cd ~/anima
./scripts/synthesis-report.sh
```

This creates `VALIDATION_SYNTHESIS.md` - a comprehensive report combining all data from both weeks.

### Step 2: Compare Weeks (2 minutes)

```bash
./scripts/compare-weeks.sh
```

This creates `reports/week-1-vs-2.md` showing:
- Week-over-week metric changes
- Learning curve analysis
- Improvement/decline patterns

### Step 3: Complete Gap Analysis (25 minutes)

Open `GAP_ANALYSIS.md` and systematically document:

1. **What V1 does well** (with evidence)
2. **What V1 struggles with** (with examples)
3. **What V1 doesn't do at all** (with use cases)
4. **Critical gaps for V2** (prioritized)

Use your journals, weekly reflections, and synthesis report to find evidence.

### Step 4: Complete Synthesis Report (20 minutes)

Open `VALIDATION_SYNTHESIS.md` and fill in sections marked `[USER TO COMPLETE]`:

- Qualitative observations
- Pattern analysis
- Testing scenario results
- Overall assessment

### Step 5: Make Your Decision (10 minutes)

Based on all the data, decide:

- ✅ **Proceed to V2:** All thresholds met, clear gaps identified
- ⚠️ **Iterate on V1:** Mixed results, trending positive
- 🔴 **Pause/Pivot:** Poor results, fundamental issues

Document your decision and reasoning in the synthesis report.

---

## Understanding Your Data

### Quantitative Metrics

**Context Quality (1-10)**
- ≥7.0: Bootstrap is working well
- 6.0-7.0: Acceptable but could improve
- <6.0: Context quality needs attention

**Continuity Score (1-10)**
- ≥7.0: Strong thread continuity
- 5.0-7.0: Weak but present continuity
- <5.0: Fragmented, not maintaining threads

**Manual Interventions**
- <1 per conversation: Low friction
- 1-2 per conversation: Moderate friction
- >2 per conversation: High friction

**Memory Growth**
- 5-10 per day: Healthy usage
- 3-5 per day: Light usage
- <3 per day: Insufficient usage
- >10 per day: May be storing noise

### Qualitative Signals

**Good Signs:**
- Surprise continuity moments (system remembers things you forgot)
- Unexpected connections between memories
- Deep synthesis (not just retrieval)
- Metrics improving week-over-week
- You want to use it daily

**Warning Signs:**
- Repeated manual corrections for same issue
- Context quality declining over time
- Avoiding using the system
- More friction than value
- No emergence or synthesis

---

## Common Scenarios

### Scenario: "My metrics are below thresholds"

**Don't panic.** Ask:

1. **Is it trending upward?** Week 2 better than Week 1?
   - If yes: You're learning the system. Consider extending validation.
   - If no: May need V1 iteration or fundamental changes.

2. **Are some aspects good?** Mixed results?
   - Identify what works and what doesn't
   - Focus V2 on addressing specific gaps

3. **Is usage consistent?** Using it daily?
   - If no: System may not be solving a real problem
   - If yes: System has potential but needs refinement

### Scenario: "I forgot to log for a few days"

**No problem.** You can:

1. Fill in journal entries retroactively (memory aid: check `reports/` for daily metrics)
2. Note the gap in your weekly reflection
3. Continue forward - some data is better than none

The automated metrics scripts still captured system-level data.

### Scenario: "I'm not sure if something is a gap or just user error"

**Document it anyway.** In gap analysis:

1. Describe what happened
2. Note uncertainty: "Unclear if system issue or my usage"
3. If it happened multiple times, it's worth noting
4. V2 can address unclear UX even if system works correctly

### Scenario: "Metrics look good but I'm not finding it useful"

**This is critical data.** This means:

1. System technically works
2. But doesn't solve your actual problem
3. This is a fundamental gap, not a polish issue
4. Document this extensively in qualitative sections

Numbers only tell part of the story. Your experience matters.

---

## Tips for Success

### Daily Logging

- **Be consistent:** Log immediately after conversations while fresh
- **Be honest:** Document failures, not just successes
- **Be brief:** 1-2 minutes max, don't overthink
- **Be specific:** "Bootstrap missed recent changes" not "context was bad"

### Weekly Reflection

- **Look for patterns:** Not individual incidents
- **Compare to previous week:** Is it getting better or worse?
- **Be forward-looking:** What will you try differently?
- **Be curious:** What are you learning about the system?

### Gap Analysis

- **Provide evidence:** Link to journal entries or metrics
- **Distinguish types:** Struggle vs completely missing
- **Prioritize ruthlessly:** What's truly critical vs nice-to-have?
- **Think about V2:** Is this gap addressable?

---

## File Reference

### Files You'll Edit

- `USAGE_JOURNAL.md` - Daily entries after each conversation
- `WEEKLY_REFLECTIONS.md` - Weekly pattern analysis
- `GAP_ANALYSIS.md` - End-of-validation gap identification
- `VALIDATION_SYNTHESIS.md` - Complete sections marked [USER TO COMPLETE]

### Files Auto-Generated

- `metrics/daily/YYYY-MM-DD.json` - Daily automated metrics
- `reports/week-N.md` - Weekly trend reports
- `reports/week-1-vs-2.md` - Week comparison
- `VALIDATION_SYNTHESIS.md` - Comprehensive synthesis (you complete sections)

### Templates (Reference Only)

- `templates/DAILY_JOURNAL_TEMPLATE.md`
- `templates/WEEKLY_REFLECTION_TEMPLATE.md`
- `templates/GAP_ANALYSIS_TEMPLATE.md`

### Scripts

- `scripts/end-conversation.sh` - Daily reflection capture
- `scripts/daily-metrics.sh` - Automated metrics collection
- `scripts/weekly-trends.sh` - Weekly trend analysis
- `scripts/synthesis-report.sh` - Bi-weekly synthesis
- `scripts/compare-weeks.sh` - Week 1 vs 2 comparison

---

## Decision Framework

At the end of Week 2, use this framework to decide next steps:

### ✅ Proceed to V2 If:

**ALL of the following are true:**
- [ ] Average context quality ≥7.0
- [ ] Average continuity ≥6.5
- [ ] Emergence moments ≥3 per week
- [ ] Manual interventions <1 per conversation
- [ ] Clear gaps identified that V2 could address
- [ ] Used system consistently (near-daily)

**Action:** Generate V2 requirements based on identified gaps

---

### ⚠️ Iterate on V1 If:

**ONE OR MORE of the following:**
- [ ] Metrics below thresholds BUT trending upward
- [ ] Some aspects work well, others don't
- [ ] Gaps identified but solution unclear
- [ ] Usage consistent but metrics mixed

**Action:** Implement V1.1 improvements, run extended validation

---

### 🔴 Pause/Pivot If:

**ONE OR MORE of the following:**
- [ ] Not using system regularly (< every 2-3 days)
- [ ] All metrics poor and not improving
- [ ] Fundamental approach seems questionable
- [ ] No measurable value after 2 weeks
- [ ] Creates more friction than value

**Action:** Deep analysis of whether approach needs rethinking

---

## Troubleshooting

### "Scripts won't run"

Check permissions:
```bash
chmod +x scripts/*.sh
```

Verify you're in the correct directory:
```bash
cd ~/anima
pwd  # Should show /Users/jcbbge/anima
```

### "Database connection errors"

Verify Anima is running:
```bash
docker ps  # Should see anima-db container
```

Check `.env` file for correct database credentials.

### "Metrics files not generating"

Ensure directories exist:
```bash
mkdir -p metrics/daily
mkdir -p reports
```

Check if daily-metrics.sh runs without errors:
```bash
./scripts/daily-metrics.sh
```

### "Don't know what to write in journal"

Use these prompts:
- What topic did we discuss?
- Did the bootstrap help or not?
- Did I need to add context manually?
- What was one thing that worked?
- What was one thing that didn't?

Even minimal notes are valuable.

---

## After Validation

### If Proceeding to V2:

1. **Create V2_REQUIREMENTS.md** using your gap analysis
2. **Prioritize features** based on critical gaps
3. **Design V2 architecture** addressing core limitations
4. **Plan V2 validation** (how will you validate V2?)

### If Iterating on V1:

1. **Identify quick wins** from gap analysis
2. **Implement improvements** to address top 2-3 gaps
3. **Run extended validation** (1-2 more weeks)
4. **Re-evaluate** with fresh data

### If Pausing:

1. **Document fundamental issues** discovered
2. **Question assumptions** about the approach
3. **Explore alternatives** if appropriate
4. **Validate hypotheses** before rebuilding

---

## Questions?

This framework is designed to be:
- **Low friction:** <5 min/day, 30 min/week
- **High signal:** Captures what matters
- **Actionable:** Data directly informs decisions

If something is unclear or too burdensome, adjust the framework. The goal is useful data, not perfect compliance.

---

## Quick Reference Card

### Daily (2 min)
```bash
./scripts/end-conversation.sh      # Capture metrics
# Edit USAGE_JOURNAL.md            # Add entry
./scripts/daily-metrics.sh         # Auto-metrics
```

### Weekly (30 min)
```bash
./scripts/weekly-trends.sh         # Generate report
# Review reports/week-N.md         # Read report
# Edit WEEKLY_REFLECTIONS.md       # Add reflection
```

### End of Week 2 (60 min)
```bash
./scripts/synthesis-report.sh      # Comprehensive synthesis
./scripts/compare-weeks.sh         # Week comparison
# Complete GAP_ANALYSIS.md         # Identify gaps
# Complete VALIDATION_SYNTHESIS.md # Final analysis
# Make decision: V2 / Iterate / Pause
```

---

**Good luck with your validation! The data you collect will be invaluable for building V2.**
