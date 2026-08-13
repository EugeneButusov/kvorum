import { Injectable } from '@nestjs/common';
import {
  AiOutputRepository,
  MISMATCH_DETECTOR_TEMPLATE,
  mismatchInputHash,
  type AiOutput,
} from '@libs/ai';
import type { ProposalAction } from '@libs/db';

// Single mismatch template → one (feature, version); the lookup is content-addressed. Derived from the
// template so an API lookup tracks the template's version.
const FEATURE = MISMATCH_DETECTOR_TEMPLATE.feature ?? MISMATCH_DETECTOR_TEMPLATE.name;
const VERSION = MISMATCH_DETECTOR_TEMPLATE.version;

/**
 * Reads a proposal's stored calldata-vs-prose mismatch analysis. `ai_output` has no proposal FK — it is
 * content-addressed by `(feature, prompt_version, input_hash)` — so this recomputes the same
 * `input_hash` the worker used (SPEC §5.6 caching) and looks it up. Returns `null` when no analysis
 * exists (non-binding / undecoded proposals are never scanned, and unprocessed / budget-capped / changed
 * description-or-actions all hash-miss). The surfacing threshold (`mismatchFlag`, ADR-080) is applied at
 * the mapper, so a stored `consistent`/`minor`/`low`-confidence analysis still resolves here but yields
 * no embedded flag.
 */
@Injectable()
export class ProposalMismatchReadService {
  constructor(private readonly outputs: AiOutputRepository) {}

  async findForProposal(description: string, actions: ProposalAction[]): Promise<AiOutput | null> {
    const inputHash = mismatchInputHash(description, actions);
    const row = await this.outputs.find(FEATURE, VERSION, inputHash);
    return row ?? null;
  }
}
