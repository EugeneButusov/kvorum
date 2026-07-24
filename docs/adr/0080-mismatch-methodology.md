# ADR-080 — Calldata-vs-prose mismatch detector methodology

- **Status**: Proposed
- **Date**: 2026-07-23
- **Spec sections affected**: 5.6, 7.2
- **Related**: ADR-078 (AI infrastructure + queue), ADR-079 (cost/cap/provenance), DR-013 (flagship)
- **Implemented by**: #439 (worker + `MismatchAnalysisSchema` + trigger), #440 (engineered prompt + surfacing threshold), #441 (validation corpus + <5% false-positive gate)

## Context

The calldata-vs-prose mismatch detector (SPEC §5.6) is the flagship AI feature (DR-013): it flags proposals whose prose description does not match the on-chain actions the calldata will execute. Delegates skim descriptions and trust them, so the detector is the safety net for honest mistakes, confused proposers, and — worst case — a proposal that hides what its calldata does.

SPEC §5.6 committed, at the level of intent, to (a) a prompt engineered to distinguish real discrepancies from cosmetic ones, (b) a conservative surfacing threshold, and (c) a <5% false-positive rate proven against a hand-curated corpus (the epic's load-bearing gate, AC #5). M5-3.1 (#439) built the worker that produces a validated `MismatchAnalysisSchema`. This ADR records the **methodology** those choices follow, so the trust posture is explicit and auditable before the feature surfaces anything to users. #441's corpus confirms it empirically.

## Decision

### 1. Flag-vs-ignore taxonomy

The prompt (`libs/ai/src/prompts/mismatch-detector.md`) instructs the model to **convert before comparing** and to ignore differences that are not real mismatches:

- unit/format reformatting — `"5%"` and `5e16` (5 × 10^16 in 18-decimal fixed point) are the same value;
- routine emissions / boilerplate the description omits because they are standard for the contract type;
- legitimate summarization that leaves out mechanical steps faithfully implementing the stated change.

And to flag five discrepancy types: `value_mismatch`, `target_mismatch`, `omitted_in_description`, `extra_in_description`, `misleading_phrasing` (SPEC §5.6). The prompt carries illustrative cosmetic-vs-real examples to anchor the boundary; #441 iterates the rules against measured cases.

### 2. Conservative surfacing threshold — one source of truth

Whether a proposal shows an `ai_mismatch_flag` is decided by a single pure function, `mismatchFlag(analysis)` (`libs/ai/src/schemas/mismatch-flag.ts`), which the eventual API field and #441's measurement harness both call:

```
flag = null  unless  overall_assessment ∈ { material_discrepancy, severe_discrepancy }
flag = null  when     confidence === 'low'
otherwise    { assessment, summary }   // summary = highest-severity discrepancy's description
```

- **Only `material`/`severe` surface.** `consistent` and `minor_discrepancy` never flag; their analysis is still stored and available via the dedicated endpoint.
- **`low`-confidence never surfaces**, even for a material/severe assessment. A guess must not raise an alarm.

**Rationale.** For an operator-first product, a false positive (warning on a benign proposal) erodes trust faster than a false negative, and the flagship's credibility is the whole point. So the bar to _surface a warning_ is deliberately high. Nothing is hidden — the full structured analysis (including `minor` and `low`-confidence cases) is always retrievable; the threshold only governs the prominent flag.

### 3. `reasoning` is user-facing; adaptive thinking is not used in v1

The schema's `reasoning` field is the model's explanation, **stored and shown directly to users** in the dashboard next to the model name and prompt version (SPEC §5.6). It is a first-class output, not scratch work. Extended/adaptive ("thinking") tokens are a separate concept — internal chain-of-thought that some models emit before their answer. v1 does **not** enable adaptive thinking: no provider configuration, no separate storage, and `reasoning` is not derived from thinking tokens. This keeps the output contract simple and the provenance clean. Revisit if #441 shows adaptive thinking materially improves accuracy at acceptable cost.

### 4. Model

`claude-sonnet-5` — mismatch detection is adversarial reasoning over two representations (prose vs decoded calldata), deeper than the summarizer's task, so the Sonnet tier is warranted (SPEC §5.6; the summarizer uses Haiku). Cost is ~$0.05/analysis, within the $20/month feature cap (ADR-079). The model is one line of template frontmatter plus provenance, so **#441's corpus is the deciding evidence** on whether Haiku reaches the <5% false-positive gate; if it does, downgrade there.

## Consequences

- The trust posture is conservative by construction: users see a flag only for material/severe, confident findings; everything else is available but de-emphasized.
- The threshold lives in exactly one function, so the policy cannot drift between the API surface and the validation harness.
- The prompt is engineered but **unmeasured until #441** — its false-positive rate is proven only against the corpus. The explicit flag/ignore rules exist so #441 can iterate them against real cases.
- Marked **Proposed**; flips to **Accepted** once #441's corpus shows <5% false positives with the seeded discrepancies caught (the epic's acceptance).
