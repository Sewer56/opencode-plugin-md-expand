# Workflow Design Patterns

Approved catalog for reusable workflow and prompt design patterns used when creating or refining commands, agents, and reviewers.

Related files:
- Design patterns: `config/doc/workflow/design-patterns.md` (this file)
- Existing-workflow optimization tactics: `config/doc/workflow/optimize-patterns.md`
- Unproven intake: `config/doc/workflow/unproven-patterns.md`
- Experiment evidence: `PROMPT-WORKFLOW-OPTIMIZE-*.md`

## How to Use

1. Classify target design traits first: command delegation, primary runner + review subagents, review loop, subagent coordination, repeated subagent/task calls, machine-readable output, diff-based machine artifacts, failure-path validation, or pattern selection.
2. Select only matching approved patterns.
3. Convert selected `Carry-In` bullets into direct instructions in target prompts or reviewers. Do not paste whole catalog text into generated files.
4. Keep scope honest. A pattern may be approved for `cross-workflow`, `iterate-family`, or `finalize-family`.
5. Existing-command optimization tactics belong in `config/doc/workflow/optimize-patterns.md`, not here.
6. Treat code blocks as generic normative shapes. Copy the structure, not placeholder names. Keep MUST/WHEN/Do-not wording unambiguous.

## Trait Matrix

| Trait | Usually Apply |
| --- | --- |
| command delegates to agent | OPT-001 |
| primary runner + review subagents | OPT-002, OPT-003, OPT-004, OPT-006, OPT-011, OPT-012, OPT-014 |
| review loop | OPT-003, OPT-004, OPT-005, OPT-009, OPT-011, OPT-012 |
| subagent coordination | OPT-002, OPT-006, OPT-012 |
| repeated subagent/task calls | OPT-003 |
| machine-readable final output | OPT-004, OPT-005, OPT-008 |
| diff-based machine artifacts | OPT-007, OPT-008, OPT-009 |
| path-only helper sections | OPT-010 |
| failure-path validation | OPT-013 |
| subagent review of partial plan | OPT-014 |
| shared pattern selection | OPT-015 |
| adjudicated high-risk review | OPT-016 |

## Approved Patterns

### OPT-001 — Thin Command Templates

- Scope: cross-workflow
- Apply When: command mainly passes user input to one agent.
- Skip When: command must validate inputs, transform arguments, choose between agents, or assemble non-trivial fixed context.
- Carry-In:
  - Command file MUST contain only frontmatter, minimal routing, and `$ARGUMENTS` when possible.
  - Agent prompt MUST own process steps, role, output format, examples, and detailed constraints.
  - Do not duplicate agent-owned instructions in command body.
  - If command needs one or two variables, define them inline near `$ARGUMENTS`; do not add a long process section.
- Expected Gain: fewer conflicting instructions and lower prompt token load.

Good:

```text
---
description: Run feature workflow
agent: _feature/run
---
$ARGUMENTS
```

Bad: command repeats # Process already owned by agent.

### OPT-002 — Tight Subagent Inputs

- Scope: cross-workflow
- Apply When: target spawns subagents or reviewers.
- Skip When: callee cannot access required files or lacks required permanent instructions in its own prompt.
- Carry-In:
  - Caller MUST pass only data needed for this run: artifact paths, scoped changed ids/paths, trigger flags, user notes, and changed decisions.
  - Caller MUST NOT paste callee-owned role text, focus list, process steps, output schema, examples, model notes, or generic read order.
  - If every call repeats the same instruction, move that instruction into the callee prompt instead.
  - If callee lacks required context, pass a path or id first. Paste content only when the callee cannot read it.
- Expected Gain: lower token use and less off-scope work.

Good:

```text
handoff_path=<path>
step_pattern=<artifact>.step.*.md
changed_ids=[STEP-003]
trigger_flags=[security_touched]
user_notes=<short notes>
```

Bad: paste reviewer focus list, output schema, role text, examples, model notes, and "read all files".

### OPT-003 — Repeated Subagent Cache

- Scope: cross-workflow
- Apply When: same subagent/task can run more than once for the same artifact or input set.
- Skip When: flow is single-pass; caller cannot provide a stable `cache_path`; inputs cannot be identified; or full reread is cheaper/safer than cache reuse.
- Carry-In:
  - Caller MUST pass `cache_path`.
  - Caller MUST pass the smallest reliable primary invalidation input: source path + revision/fingerprint, changed paths, changed item ids, or `## Delta`.
  - Caller MUST also pass decisions or trigger flags when they can invalidate cached conclusions.
  - Callee owns cache contents. Target prompt may define exact schema.
  - Callee MUST read existing cache first when the cache file exists.
  - If cache is missing or malformed, callee MUST do a full needed read and write a fresh cache.
  - Callee MUST reread material when cache is missing/stale, path or item is Changed/New, finding is open/unresolved, or decision/trigger touches its domain.
  - Callee MUST preserve unchanged verified cache records byte-for-byte.
  - Callee MUST update cache before final response.
- Expected Gain: fewer repeated reads, cheaper re-invocation, less duplicate reasoning.

Choose invalidation input by workflow shape:

- Whole-artifact: one input file. Caller passes source path plus revision/fingerprint. Callee rereads whole file only when revision/fingerprint changed or cache is stale.
- File-level: multiple input files. Caller passes changed paths. Callee reopens changed paths only.
- Item-level: stable item ids exist. Caller passes `## Delta`, `changed_ids`, or equivalent item statuses. Callee reopens Changed/New items only.
- Decision-level: decisions or trigger flags can invalidate cached conclusions. Caller passes decisions/trigger flags. Callee reopens only records whose domain is touched.

If no item ids exist, use `<source-path>` or `<source-path>#whole` as the cache record id.

Cache record rules:

- One stable record per item/path/source.
- Each verified record MUST contain enough evidence to trust without rereading unchanged input.
- Each open finding MUST name expected fix condition or exact diff.
- Resolved findings stay in cache with `Status: RESOLVED` and short resolution note.
- Do not rewrite unchanged records for wording cleanup.

Cache file shape:

```text
# Cache: <agent/domain>
Scope: <owned domain>
Source Inputs: <path(s)>
Invalidation Basis: <whole-artifact | changed_paths | delta | changed_ids | revision | decisions>
Source Revision/Fingerprint: <optional rev/hash/iteration>

## Verified Observations
- <item-id>: <grounding snapshot / evidence / verified condition>

## Item Records
### <item-id>
Last Decision: PASS | ADVISORY | BLOCKING
Open Findings: <ids or none>
Evidence: <paths/lines/snapshots>
Verified: <condition>
Decision Refs: <DEC-* or none>

## Findings
### [DOM-001]
Status: OPEN | RESOLVED | DEFERRED
Severity: BLOCKING | ADVISORY
Evidence: <snapshot/ref>
Expected Fix: <condition or diff>
Resolution: <only when resolved>
```

Reviewer example (specialized case):

```text
Delta:
STEP-001: Changed
STEP-002: Unchanged

Reviewer action:
open STEP-001
preserve cached PASS for STEP-002 byte-for-byte
reopen STEP-002 only if decision/domain touches it
```

### OPT-004 — Fixed Structured Output Blocks

- Scope: cross-workflow
- Apply When: machine-readable final answers or reviewer outputs matter.
- Skip When: output is intentionally free-form human prose.
- Carry-In:
  - Prompt MUST define one exact output block.
  - For plain structured output, use fenced `text` block.
  - Output MUST keep heading names, field names, order, and allowed values stable.
  - Output MUST include required empty sections when schema expects them.
  - Output MUST NOT include greetings, summaries, or prose outside the block.
  - Use JSON only when the consumer explicitly requires JSON.
- Expected Gain: better parser reliability and less format drift.

Good:

```text
~~~text
# REVIEW
Decision: PASS | ADVISORY | BLOCKING
## Findings
## Verified
## Notes
~~~
```

Bad: greeting, JSON, or prose outside fenced block.

### OPT-005 — Reference Instead of Requote

- Scope: cross-workflow
- Apply When: multiple artifacts share context or requirements.
- Skip When: target artifact must stand alone and pointer-only wording would make it unusable.
- Carry-In:
  - Reference existing content by file path, section heading, item id, or finding id.
  - Quote only the smallest required snippet when exact wording matters.
  - Do not duplicate full requirements, full deltas, full rules, full reviewer outputs, or full design catalogs into multiple artifacts.
  - If target must stand alone, include a short summary plus canonical source pointer, not a full copy.
  - Do not reference prior chat as durable source; write durable context to a file first.
- Expected Gain: lower prompt size, less divergence between copies.

Good:

```text
See handoff ## Delta for changed items.
Reviewers read only Changed/New STEP files.
```

Bad: paste full Delta table plus full design catalog into every reviewer prompt.

### OPT-006 — Shared Context File

- Scope: cross-workflow
- Apply When: workflow spawns ≥2 subagents and any information must be shared between them.
- Skip When: single subagent, or subagents fully independent — no shared input, decisions, or results needed.
- Carry-In:
  - Caller MUST create or name one shared context file path.
  - Shared context file MUST hold any information that >1 subagent needs: input summaries, decisions, changed ids/paths, step indices, reviewer findings, arbitration notes, or result pointers.
  - Put only shared information in the context file. Domain-specific evidence stays in domain cache files (OPT-003) or subagent outputs.
  - Each writer MUST own only its domain sections. Caller or caller-agent owns cross-domain decisions and structure.
  - Each reader MUST read only sections it needs for its domain.
  - Do not scatter durable shared information across chat messages or unrelated subagent outputs.
  - When OPT-003 applies, context file stores summaries and pointers; domain caches store detailed evidence.
- Expected Gain: cleaner handoffs, less rediscovery, no scattered shared state.

```text
<artifact>.handoff.md
  ## Shared Input       ← caller-agent owns
  ## Decisions          ← caller-agent owns
  ## Review Ledger       ← reviewers write own findings
  → domain cache files  ← per-reviewer detailed evidence (OPT-003)
```

### OPT-007 — Diff Line Locators

- Scope: iterate-family
- Apply When: machine artifacts tell implementers or reviewers where to edit.
- Skip When: artifact uses create-only full-file outputs.
- Carry-In:
  - Each edit step MUST list approximate target ranges as `Lines: ~start-end`.
  - If one step has multiple hunks, list each range in the step header.
  - Each hunk MUST have a matching per-hunk label, e.g. `**Lines: ~40-55**`.
  - Each diff hunk MUST include at least 2 unchanged context lines before and after changed lines when available.
  - Context text is authoritative. Line numbers are hints only.
  - Do not use full-file ranges for localized edits.
- Expected Gain: faster targeted reads and fewer locator ambiguities.

```text
STEP-001 | Lines: ~40-55, ~80-92

**Lines: ~40-55**
~~~diff
 unchanged context
-old text
+new text
 unchanged context
~~~
```

### OPT-008 — Nested Code Fence Safety

- Scope: cross-workflow
- Apply When: generated docs or prompts nest fenced code blocks.
- Skip When: no nested fences exist.
- Carry-In:
  - Outer fence MUST use backticks (```). Inner fence MUST use tildes (~~~).
  - Do not nest backticks inside backticks at the same count.
  - Do not nest tildes inside tildes at the same count.
- Expected Gain: prevents malformed markdown and accidental fence closure.

Good:

```text
outer fence = ```
inner fence = ~~~diff
```

Bad:

```text
outer fence = ```
inner fence = ```diff
```

### OPT-009 — Reviewer Inline Diffs When Exact

- Scope: finalize-family
- Apply When: reviewer can specify concrete fix text.
- Skip When: finding is conceptual and exact patch is not reliable.
- Carry-In:
  - Reviewer MUST include an inline unified diff after `Fix:` only when exact replacement text, target path, and surrounding context are known.
  - Diff MUST target the artifact the implementer should edit.
  - Diff MUST include enough unchanged context for safe application.
  - If exact text or context is uncertain, reviewer MUST write prose fix only and MUST NOT invent a diff.
  - Conceptual findings MUST stay conceptual; do not fake precision.
- Expected Gain: easier mechanical application of reviewer feedback.

Exact:

```text
Fix: replace stale field
~~~diff
--- a/<path>
+++ b/<path>
 unchanged context
-old text
+new text
~~~
```

Conceptual: prose only, no fake diff.

### OPT-010 — Inline Path Variables

- Scope: iterate-family
- Apply When: a section body contains only `name=<path>` assignments with no accompanying prose.
- Skip When: any assignment needs explanation, ownership notes, environment precedence, or cross-file context.
- Carry-In:
  - Remove the standalone section and move its assignments to the start of the nearest `## Process`, `## Workflow`, or equivalent execution section.
  - Keep each assignment on its own line as `name=<path>`.
  - Do not inline when any assignment cannot stand without surrounding context.
- Expected Gain: shorter prompts and flatter document shape.

Good:

```text
## Process
PRIMARY_ROOT=<main-root>/
LOCAL_ROOT=<override-root>/
agent_paths=<root>/agent/**
```

Bad: separate ## Path Variables section containing only those `name=<path>` lines with no prose.

### OPT-011 — Triggered Reviewer Sets

- Scope: finalize-family
- Apply When: reviewer cost varies by complexity/risk or trivial plans can safely skip high-cost reviewers.
- Skip When: every reviewer is always required for correctness.
- Carry-In:
  - Orchestrator MUST choose reviewer set before dispatch.
  - Selection MUST consider step count, action mix, changed paths, risk flags, performance sensitivity, security/correctness impact, and triviality.
  - Orchestrator MUST include every reviewer required for correctness, security, data-loss, or touched high-risk domains.
  - Orchestrator MAY skip high-cost reviewers only when their domain is untouched and skip is safe by explicit criteria.
  - Advisory-only findings MUST be recorded/deferred unless workflow explicitly requires advisory cleanup before completion.
  - If risk is unclear, include the safer reviewer.
- Expected Gain: less reviewer fan-out and better elapsed/token profile.

```text
docs-only change -> wording + docs reviewers
code+test change -> correctness + tests reviewers
performance-sensitive change -> add performance reviewer
advisory-only finding -> record/defer, no full rerun
```
### OPT-012 — Explicit Reviewer Scope Boundaries

- Scope: cross-workflow
- Apply When: multiple reviewers own different domains.
- Skip When: single reviewer owns full judgment.
- Carry-In:
  - Each reviewer prompt MUST state its owned domain.
  - Each reviewer prompt MUST state what to check and what not to check.
  - Reviewer MUST NOT deeply investigate out-of-scope concerns.
  - If reviewer notices out-of-scope concern, it may add one short pointer in `## Notes` or equivalent.
  - Reviewer MUST NOT create blocking findings for another reviewer's domain unless prompt explicitly allows it.
  - Optimization/evaluation MUST check for scope leakage and duplicate findings across reviewers.
- Expected Gain: less overlap, less token waste, clearer ownership.

```text
Tests reviewer focus: test coverage only
If security issue noticed:
## Notes
- Security concern: <short pointer>

Do not investigate security; security/correctness reviewer owns it.
```

### OPT-013 — Fast-Fail Preconditions

- Scope: cross-workflow
- Apply When: missing prerequisite should stop work immediately.
- Skip When: target can recover cheaply from missing inputs.
- Carry-In:
  - Workflow MUST run the exact minimal prerequisite check before broad reads, discovery, subagent calls, or writes.
  - Check MUST have one clear pass condition.
  - If check fails, workflow MUST emit the final failure template immediately.
  - After failure, workflow MUST stop. Do not continue discovery, reviewer calls, artifact writes, or best-effort recovery.
  - Do not read rules or scan repository files before a failing precondition unless the check itself needs that read.
- Expected Gain: lower failure-path cost and better correctness.

```text
Step 1:
glob plan_path

If matches != 1:
  return FAIL template
  stop immediately

Do not read rules, scan repo files, spawn reviewers, or write artifacts.
```

### OPT-014 — Per-File Step Scoping Reduces Reviewer Context

- Scope: cross-workflow
- Apply When: subagents review subsets of a machine plan and the plan has multiple steps.
- Skip When: plan is trivial (1–2 steps) or there is only one reviewer that reads everything.
- Carry-In:
  - Keep each implementation/test/reviewable step in its own file with stable step id.
  - Keep a step index in the handoff or main plan so callers can map ids to files.
  - Caller MUST pass reviewers only relevant step paths or changed step ids/paths when possible.
  - Use `## Delta` only when the workflow already has item-level Delta; otherwise use changed step paths or ids.
  - Reviewer MUST open only in-scope step files unless its prompt requires full-plan review.
  - Do not merge step files into one monolithic plan only to reduce tool calls.
- Expected Gain: smaller reviewer context windows, less scope leakage, lower total token cost despite more tool calls.

```text
Files:
STEP-001.md
STEP-002.md
STEP-003.md

Delta:
STEP-001: Changed
STEP-002: Unchanged
STEP-003: New

Tests reviewer opens only test-related Changed/New steps.
Do not merge into one machine.md just to reduce tool calls.
```

### OPT-015 — Central Pattern Selector

- Scope: cross-workflow
- Apply When: a creation/refinement workflow needs shared design guidance without embedding the full catalog in the main agent.
- Skip When: only one small pattern ever applies or selector overhead outweighs saved prompt text.
- Carry-In:
  - Caller MUST call at most one selector for pattern selection.
  - Selector input MUST include target summary, target paths, and behavior traits.
  - Selector MUST read this catalog and return only matched pattern ids plus compact carry-in rules.
  - Selector MUST NOT return full catalog text.
  - Caller MUST apply only returned matched patterns unless later evidence changes traits.
  - Caller MUST NOT paste this full catalog into generated artifacts or downstream prompts.
- Expected Gain: less prompt duplication, lower rule drift, and smaller main-agent context.

```text
Selector input:
target_summary=<short behavior>
target_paths=[<paths>]
behavior_traits=[subagent coordination, structured output]

Selector output:
OPT-002 | Carry-In: pass paths/delta/flags only
OPT-004 | Carry-In: fenced text output

Main agent applies only returned carry-ins.
```

### OPT-016 — Adjudicated High-Risk Review

- Scope: cross-workflow
- Apply When: a missed issue in the review domain could make the artifact invalid, unsafe, misleading, or structurally malformed (correctness, security, data-loss, API/CLI contracts, schema/diff/path validity, release gates).
- Skip When: low-risk polish, style, formatting, token density, non-blocking docs.
- Carry-In:
  - Per high-risk domain: `<domain>-adjudicator`
    - Calls independent `<domain>-a` + `<domain>-b` (same artifact, isolated)
    - Legs import shared reviewer text from sidecar `.txt` via `{file:...}`
    - One adjudicator per domain, never shared
  - Adjudicator duties:
    - Use the same domain scope as A/B, but do not run as reviewer C
    - Validate terse A/B outputs
    - Merge duplicates by root cause
    - Keep single-leg findings when evidence is concrete and in scope
    - Drop findings without evidence or outside domain
    - Pick smallest safe fix on conflicts
    - Cached: read sidecar actions first, sidecar caches only when needed; write canonical cache plus current actions file; emit `# REVIEW` pointer with `Actions:` and `Cache:`
    - Cacheless: parse findings from each leg's inline `## Findings` section; emit merged findings inline in output block; do not read or write sidecar files
    - Primary reads `Actions:` for current fixes (cached) or inline findings (cacheless)
    - Primary treats `Cache:` as reviewer-owned state for future review calls and ledger references, not fix input
  - Re-review: one reviewer reads its own cache, reuses verified unchanged records, inspects changed material, updates cache, no adjudicator wrapping
  - Final audit before READY/SUCCESS:
    - Cacheless variant inspects all artifacts from scratch, returns findings inline, does not read or write cache files
    - Always: correctness/validity
    - Conditional: docs (user-facing surface, API, CLI, config, migration)
    - Rare: wording (prompt/rule artifact, late operational changes, prior BLOCKING)
  - Risk tiers:
    - High-risk → adjudicated double-check + final audit
    - Low-risk → single reviewer + single-reviewer final audit
  - After fix: rerun touched domains only
- Expected Gain: fewer missed high-risk issues, reliable release gates, cost scaled by risk.

```text
Topology (<domain> = correctness, audit, plan-reviewer, freeform-reviewer):
  CACHED path:
    caller -> <domain>-adjudicator-cached (normal iterations)
             <domain>-adjudicator-cached -> <domain>-a-cached + <domain>-b-cached (shared.txt + shared-cached.txt)
             adjudicator reads sidecar actions/caches -> canonical actions + cache/ledger + # REVIEW pointer (Actions:, Cache:)

  CACHELESS path:
    caller -> <domain>-adjudicator-cacheless (final full-artifact audit)
             <domain>-adjudicator-cacheless -> <domain>-a-cacheless + <domain>-b-cacheless (shared.txt + shared-cacheless.txt)
             legs return findings inline -> adjudicator parses inline ## Findings -> merged inline findings + # REVIEW block (no Cache:, no Actions:)

  RE-REVIEW:
    single <domain>-rereview (cache + changed material)
```
