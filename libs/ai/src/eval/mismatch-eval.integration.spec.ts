import { describe, expect, it } from 'vitest';
import {
  createAnthropicProvider,
  createLlmClient,
  createOpenAiEmbeddingProvider,
  MISMATCH_DETECTOR_TEMPLATE,
  render,
  serializeDecodedActions,
  type CompletionRequest,
  type LLMClient,
  type MismatchAnalysis,
} from '@libs/ai';
import type { ProposalAction } from '@libs/db';
import { MISMATCH_CORPUS, type MismatchCorpusCase } from './mismatch-corpus.js';
import { FP_GATE, scoreEval, type EvalEntry } from './score.js';

/**
 * Real-Sonnet measurement of the mismatch detector against the labeled corpus (SPEC §5.6 AC #5).
 *
 * This is the harness that produces the <5% false-positive gate number. It is gated on
 * `ANTHROPIC_API_KEY`, so it **skips** in normal CI (no key → no LLM calls, no cost) and the
 * operator runs it on demand:
 *
 *   ANTHROPIC_API_KEY=sk-... pnpm --filter @libs/ai exec vitest run mismatch-eval.integration
 *
 * It drives the **production** template + `render` + serializer + completion request (identical to
 * `MismatchAssembler`/`MismatchHandler`), so it measures exactly what the worker runs. Drop real
 * proposals into MISMATCH_CORPUS (same shape) to strengthen the corpus — no code change needed.
 */
const describeEval = process.env['ANTHROPIC_API_KEY'] ? describe : describe.skip;

function buildClient(): LLMClient {
  return createLlmClient({
    provider: createAnthropicProvider({ apiKey: process.env['ANTHROPIC_API_KEY'] as string }),
    // Embeddings are never called on the sync completion path; a sentinel key is fine.
    embeddingProvider: createOpenAiEmbeddingProvider({
      apiKey: process.env['OPENAI_API_KEY'] ?? 'unset-openai-key',
    }),
  });
}

async function analyze(client: LLMClient, c: MismatchCorpusCase): Promise<MismatchAnalysis> {
  const rendered = render(MISMATCH_DETECTOR_TEMPLATE, {
    description: c.description,
    decoded_actions: serializeDecodedActions(c.decoded_actions as unknown as ProposalAction[]),
  });
  const req: CompletionRequest<MismatchAnalysis> = {
    feature: rendered.feature,
    promptVersion: rendered.promptVersion,
    model: rendered.model,
    schema: rendered.schema,
    messages: rendered.messages,
    mode: 'sync',
    inputContent: rendered.inputContent,
  };
  const res = await client.complete(req);
  return res.output;
}

describeEval('mismatch detector — corpus false-positive gate (real Sonnet)', () => {
  it('keeps the false-positive rate under 5% with every seeded discrepancy caught', async () => {
    const client = buildClient();
    const entries: EvalEntry[] = [];
    const errors: { id: string; error: string }[] = [];

    // Sequential on purpose: rarely run, and it stays under provider concurrency limits.
    for (const c of MISMATCH_CORPUS) {
      try {
        entries.push({ case: c, analysis: await analyze(client, c) });
      } catch (err) {
        errors.push({ id: c.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    const summary = scoreEval(entries);

    // Operator-facing readout (the table the standalone runner used to print).
    console.table(
      summary.cases.map((r) => ({
        id: r.id,
        expect: r.expectedFlag,
        predict: r.predictedFlag,
        outcome: r.outcome,
        seeded: r.seededCaught,
      })),
    );
    const seeded =
      summary.seededCaughtRate === null ? 'n/a' : `${(summary.seededCaughtRate * 100).toFixed(1)}%`;
    console.log(
      `tp/tn/fp/fn=${summary.tp}/${summary.tn}/${summary.fp}/${summary.fn} ` +
        `fpRate=${(summary.fpRate * 100).toFixed(1)}% seededCaught=${seeded} ` +
        `(${errors.length} errored)`,
    );
    for (const e of errors) console.error(`  ! ${e.id}: ${e.error}`);

    expect(errors, 'every corpus case must complete without an API/schema error').toEqual([]);
    expect(summary.fpRate, 'false-positive rate must be under the 5% gate').toBeLessThan(FP_GATE);
    expect(summary.seededCaughtRate, 'every seeded discrepancy must be caught').toBe(1);
    expect(summary.passed).toBe(true);
  }, 600_000);
});
