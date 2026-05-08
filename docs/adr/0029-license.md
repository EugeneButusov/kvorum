# ADR-029 — Code license MIT; data license CC-BY-4.0

- **Status**: Proposed (operator decision pending)
- **Date**: 2026-05-08
- **Spec sections affected**: 1.6
- **Related**: DR-001

## Context

SPEC §1.6 says "Self-hostable for teams who require it." The spec is otherwise silent on licensing — no LICENSE file, no terms for self-hosting, no statement on how Kvorum's outputs (analytical exports, AI summaries) may be used by API consumers. Self-hosting requires a license; integrations need to know the terms; downstream uses (research papers citing Kvorum data) need to know what attribution is expected.

Three distinct licensing surfaces:

1. **The Kvorum codebase itself** — what may someone do with the source on GitHub.
2. **The data Kvorum re-publishes** — analytical exports, AI-generated summaries, derived metrics. Underlying on-chain and Snapshot data are not Kvorum's to license.
3. **The Kvorum name and brand** — separate from the code; trademark posture.

DR-001 commits to "free maximizes adoption — for a portfolio-stage product, distribution beats revenue." A permissive license aligns with that posture.

## Decision

This ADR is **Proposed** rather than Accepted because licensing is a value choice the operator owns. The recommended defaults below are based on the spec's stated positioning; the operator confirms or amends before the ADR moves to Accepted.

**Recommended defaults:**

- **Code: MIT License.** Permissive, commercially-friendly, the de-facto standard for tooling and infrastructure. Allows self-hosting, modification, redistribution, and commercial use without copyleft obligations.

- **Data: CC-BY-4.0** for Kvorum's derived output (analytical exports, AI summaries, similarity-search results). Underlying on-chain data is public-domain by virtue of being on-chain; Snapshot data is licensed by Snapshot under their terms; Kvorum claims no rights over either source. CC-BY-4.0 requires attribution but permits any use.

- **Brand: "Kvorum" name and logo reserved.** The code is MIT but the project name is not part of that grant. A short trademark notice in the LICENSE file states that the name may be used to refer to the project but not to brand a fork or derivative.

A `LICENSE` file at the repository root holds the MIT text. A `LICENSE-DATA.md` documents the CC-BY-4.0 terms for derived output, including the attribution string Kvorum requests in citations: *"Data via Kvorum (https://kvorum.example), CC-BY-4.0."* A `TRADEMARKS.md` covers the brand reservation.

## Alternatives considered

- **AGPL-3.0 for code.** Stronger reciprocity (network use triggers source disclosure) but discourages downstream adoption — many organizations forbid AGPL software on principle. Misaligned with the "maximize adoption" positioning of DR-001.
- **Apache-2.0 for code.** Includes an explicit patent grant; marginally heavier than MIT. Defensible alternative; some contributors prefer it for its patent provisions. The recommendation is MIT for simplicity, but Apache-2.0 is a fine substitute if preferred.
- **Source-available (e.g., BSL with time conversion).** Permits restrictions on commercial use until a future date. Inappropriate for a portfolio project; signals "we plan to monetize and you can't compete."
- **Public domain (CC0) for code.** Maximally permissive but waives liability disclaimers in jurisdictions that don't recognize public domain. MIT achieves the same practical effect with cleaner legal grounding.
- **Proprietary.** Contradicts §1.6.

## Consequences

- **Once Accepted**, the LICENSE file is added to the repository root and the `package.json` `license` field is set to `MIT`. CI verifies the LICENSE file's presence on every build.
- Self-hosting is unrestricted; no contributor license agreement is needed.
- A future paid tier (DR-001's anticipated Pro tier) is not blocked: MIT permits proprietary derivative work, so Kvorum's hosted service can layer features on top of the open core.
- API consumers attributing Kvorum in research or articles use the requested string; failure to attribute is a CC-BY-4.0 violation but in practice is rare and not actively enforced for non-commercial uses.
- The trademark reservation discourages drive-by forks pretending to be the official project.
- **Operator action required**: confirm MIT vs. Apache-2.0 for code; confirm CC-BY-4.0 for data; confirm the trademark posture. Once confirmed, this ADR's status flips to Accepted and the LICENSE files are added.
