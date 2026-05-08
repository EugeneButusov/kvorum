# ADR-029 — Code license: AGPL-3.0 (existing LICENSE file)

- **Status**: Accepted
- **Date**: 2026-05-08
- **Spec sections affected**: 1.6
- **Related**: DR-001

## Context

SPEC §1.6 commits to "Self-hostable for teams who require it." The spec is otherwise silent on licensing — what may someone do with the source on GitHub? what attribution is expected for analytical exports? what protects the project name?

A `LICENSE` file already exists at the repository root (committed as part of the initial commit) containing the **GNU Affero General Public License v3.0**. This ADR records the operator's decision to keep AGPL-3.0 as the project's code license, and documents why that choice fits Kvorum's positioning.

## Decision

**Code: GNU Affero General Public License v3.0 (AGPL-3.0).** The existing `LICENSE` file at the repository root is the canonical license. AGPL-3.0 is a strong-copyleft license with a network-use clause: anyone running a modified version of Kvorum on a network-accessible server must offer their users the modified source code, under the same license.

Choosing AGPL is a deliberate alignment with the project's positioning:

- **Operator-first analytics for DAO governance** is fundamentally a transparency claim. AGPL extends that claim to the code itself: anyone running a Kvorum-based service has to keep it open. Closed-source forks that build on Kvorum's analytical work would undermine the open-data positioning of §1.6.
- **Hosted derivatives must remain open.** Without the AGPL network clause, a hosted competitor could take Kvorum, add proprietary features, and offer a closed service — gaining commercially from the open work without contributing back. The network clause closes that loophole specifically for the SaaS case Kvorum operates in.
- **Self-hosting remains unrestricted.** AGPL does not prevent or charge for self-hosting; it only requires that downstream operators running a modified version offer their network users the corresponding source. Internal-use teams and organizations running their own copy are unaffected in practice.

## Open follow-ups

The data license and trademark posture remain as recommendations pending operator decision. They are not blocked by this ADR but should be settled before public launch:

- **Data license (recommended: CC-BY-4.0)** for Kvorum's derived output (analytical exports, AI summaries, similarity-search results). Underlying on-chain data is public-domain by virtue of being on-chain; Snapshot data is licensed by Snapshot under their own terms; Kvorum claims no rights over either source. CC-BY-4.0 requires attribution but permits any use. A `LICENSE-DATA.md` file would document this with the requested attribution string.
- **Trademark (recommended: name and logo reserved)** with a `TRADEMARKS.md` covering the brand reservation. The code is AGPL-3.0 but the project name is not part of that grant; using "Kvorum" to brand a hosted fork should require permission.

These can be addressed in a follow-up ADR if and when the operator wants them formally on the record. Until then: derived output is implicitly governed by the AGPL-3.0 network-use terms (operators of modified versions must offer source to their users), and the brand is asserted by ownership without formal trademark registration.

## Alternatives considered

- **MIT or Apache-2.0.** Permissive; rejected because they permit closed-source hosted derivatives. For an open-data, transparency-driven analytics platform, allowing a closed fork to host Kvorum without contributing back is the wrong incentive.
- **GPL-3.0 (without Affero clause).** Strong copyleft but does not cover network use. For a SaaS-shaped product like Kvorum, this is the same loophole as MIT in practice — a hosted service is not "distributing" the code under classical GPL, so modifications can stay private.
- **Source-available (e.g., BSL with time conversion).** Permits time-limited restrictions on commercial use. Inappropriate for a portfolio project; signals an intent to monetize that the spec's positioning explicitly disclaims.
- **Public domain (CC0).** Maximally permissive; loses every protection AGPL provides.

## Consequences

- The existing `LICENSE` file remains as-is. `package.json`'s `license` field (when M0 sets up the monorepo) is `AGPL-3.0-or-later`.
- Self-hosting is permitted and unrestricted; the only requirement is that anyone running a modified version on a network server offers their users the modified source.
- Closed-source proprietary forks of Kvorum offered as hosted services are not permitted. Internal-only forks (run privately by a team for their own use, with no network users outside the team) are permitted because they are not "conveying" the work in the AGPL sense.
- A future paid tier (DR-001's anticipated Pro tier) is allowed: AGPL does not prevent commercial hosting, it only requires that the source remain open. Kvorum's hosted service can charge for hosting, support, and SLA while keeping the code public — the standard "open core / commercial hosting" pattern.
- Contributors retain copyright in their contributions; the project does not require a CLA. Contributions are licensed inbound under AGPL-3.0 by virtue of submission, per GitHub's standard inbound=outbound assumption.
- Data license and trademark are open follow-ups (above), not blockers for v1 launch.
