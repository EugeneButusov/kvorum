# ADR-044 - Cursor-with-conflicting-query returns 400 (SPEC §4.8 status-table erratum)

- **Status**: Accepted (2026-05-15)
- **Date**: 2026-05-15
- **Spec sections affected**: 4.5, 4.8
- **Related**: ADR-043 (voting window blocks — also amends §4.5), issue #36 (Epic H / H3)

## Context

The API encodes the originating request's filter and sort parameters into an opaque pagination cursor. When a client passes a cursor together with query parameters that conflict with the ones the cursor was minted for, the request must be rejected.

`docs/SPEC.md` is internally contradictory on the status code for this case:

- **§4.5 (prose):** "passing a cursor with conflicting query parameters returns `400 Bad Request`."
- **§4.8 (status table):** maps "Cursor with conflicting query parameters" to **422 Unprocessable Entity**.

Issue #36's acceptance criteria say "conflicting filter on page 2 → 400 with violations." The §4.8 table's own 400 row already reads "invalid query parameters, malformed cursor, validation failure" — cursor-conflict fits that description — and the §4.8 violations example body itself shows `"status": 400`. So §4.5, issue #36, and §4.8's own 400-row description all agree; only the §4.8 table mapping says 422.

`docs/SPEC.md` is frozen at v1.0. Editing the frozen specification document in flight is undesirable; a decision record is the established mechanism for amending it (cf. ADR-043, which likewise amends §4.5).

## Decision

The API returns **400 Bad Request** (problem+json, `type` slug `cursor-parameter-mismatch`, with a `violations[]` entry) when a cursor is presented alongside conflicting filter/sort query parameters.

The §4.8 status-table row mapping this scenario to 422 is declared an **erratum**. SPEC §4.5 prose is authoritative. `docs/SPEC.md` is **not** modified; this ADR is the amendment of record. The implementing exception filter carries an inline comment citing this ADR at the point the 400 is produced.

422 remains reserved for genuinely semantically-invalid-but-well-formed requests that have no cursor-conflict character.

## Consequences

1. **Gain - internal consistency.** Code, §4.5 prose, and issue #36 acceptance all agree; the lone divergent §4.8 table cell is explicitly superseded.
2. **Gain - client simplicity.** Cursor-conflict joins the same 400 class as malformed cursors and validation failures, so clients need one error path for "your pagination request is bad," not two.
3. **Cost - SPEC/ADR indirection.** A reader of frozen §4.8 sees 422 and must know ADR-044 overrides it. Mitigated by the inline code comment and this ADR's "Spec sections affected" header.
4. **Neutral - no behavioural ambiguity for 422.** 422 is still emitted for other semantically-invalid requests; this ADR only removes the cursor-conflict scenario from 422.

## Alternatives considered

1. **Edit `docs/SPEC.md` §4.8 to read 400.** Rejected. The SPEC is frozen at v1.0; amendments go through ADRs (consistent with ADR-043's treatment of the same section).
2. **Honour §4.8 and return 422 for cursor-conflict.** Rejected. Contradicts §4.5 prose, issue #36 acceptance, and §4.8's own 400-row description and example body; would split "bad pagination request" across two status codes for no client benefit.
3. **Return 400 but only track the discrepancy in an issue.** Rejected. An issue is ephemeral and non-authoritative; the SPEC contradiction needs a durable, discoverable record co-located with the other SPEC amendments.
