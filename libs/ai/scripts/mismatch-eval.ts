/*
 * Mismatch-detector validation harness (SPEC §5.6 AC #5, plan-m5-3.3).
 *
 * Runs the engineered mismatch prompt against the labeled corpus, applies the #440 `mismatchFlag`
 * surfacing policy, and reports the false-positive / false-negative / seeded-catch rates plus a
 * PASS/FAIL against the <5% false-positive gate. Requires real Sonnet calls:
 *
 *   ANTHROPIC_API_KEY=sk-... pnpm mismatch:eval
 *
 * Exits non-zero when the gate fails or any case errors, so it can gate a run. Drop real proposals
 * into MISMATCH_CORPUS (same shape) to strengthen the corpus — no code change needed.
 *
 * The prompt template is read from disk here (not via the `*.md?raw` import) because this is a plain
 * node/tsx runner, not a bundled build.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MISMATCH_CORPUS } from '../src/eval/mismatch-corpus.js';
import type { MismatchCorpusCase } from '../src/eval/mismatch-corpus.js';
import { scoreEval } from '../src/eval/score.js';
import type { EvalEntry } from '../src/eval/score.js';
import { createLlmClient } from '../src/llm/llm-client.js';
import type { LLMClient } from '../src/llm/ports.js';
import { createAnthropicProvider } from '../src/llm/providers/anthropic-provider.js';
import { createOpenAiEmbeddingProvider } from '../src/llm/providers/openai-embedding-provider.js';
import { defineTemplates, getTemplate } from '../src/prompts/registry.js';
import { render } from '../src/prompts/renderer.js';
import type { PromptTemplate } from '../src/prompts/types.js';
import {
  MismatchAnalysisSchema,
  MISMATCH_ANALYSIS_SCHEMA_NAME,
  type MismatchAnalysis,
} from '../src/schemas/mismatch-analysis.js';
import { serializeDecodedActions } from '../src/schemas/proposal-summary-input.js';

const apiKey = process.env['ANTHROPIC_API_KEY'];
if (apiKey === undefined || apiKey === '') {
  console.error('ANTHROPIC_API_KEY is required to run the mismatch eval (real Sonnet calls).');
  process.exit(1);
}

const template = getTemplate(
  defineTemplates([
    {
      raw: fs.readFileSync(path.join(__dirname, '../src/prompts/mismatch-detector.md'), 'utf8'),
      schema: MismatchAnalysisSchema,
      schemaName: MISMATCH_ANALYSIS_SCHEMA_NAME,
    },
  ]),
  'mismatch_detector',
) as PromptTemplate<MismatchAnalysis>;

function buildClient(): LLMClient {
  return createLlmClient({
    provider: createAnthropicProvider({ apiKey: apiKey as string }),
    // never called on the completion path; a sentinel is fine.
    embeddingProvider: createOpenAiEmbeddingProvider({
      apiKey: process.env['OPENAI_API_KEY'] ?? 'unset-openai-key',
    }),
  });
}

async function analyze(
  client: LLMClient,
  c: MismatchCorpusCase,
): Promise<MismatchAnalysis | { error: string }> {
  const rendered = render(template, {
    description: c.description,
    decoded_actions: serializeDecodedActions(c.decoded_actions as never),
  });
  try {
    const res = await client.complete({
      feature: rendered.feature,
      promptVersion: rendered.promptVersion,
      model: rendered.model,
      schema: rendered.schema,
      messages: rendered.messages,
      mode: 'sync',
      inputContent: rendered.inputContent,
    });
    return res.output;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const client = buildClient();
  const entries: EvalEntry[] = [];
  const errors: { id: string; error: string }[] = [];

  for (const c of MISMATCH_CORPUS) {
    const out = await analyze(client, c);
    if ('error' in out) {
      errors.push({ id: c.id, error: out.error });
      console.error(`  ! ${c.id}: ${out.error}`);
      continue;
    }
    entries.push({ case: c, analysis: out });
  }

  const summary = scoreEval(entries);

  console.log('\n  id                                       expect  predict  outcome  seeded');
  console.log('  ' + '-'.repeat(78));
  for (const r of summary.cases) {
    console.log(
      `  ${r.id.padEnd(40)} ${String(r.expectedFlag).padEnd(7)} ${String(r.predictedFlag).padEnd(8)} ${r.outcome.padEnd(8)} ${r.seededCaught === null ? '-' : String(r.seededCaught)}`,
    );
  }

  console.log('\n  Summary');
  console.log(`    cases:            ${summary.total} (${errors.length} errored)`);
  console.log(`    tp/tn/fp/fn:      ${summary.tp}/${summary.tn}/${summary.fp}/${summary.fn}`);
  console.log(`    false-positive:   ${pct(summary.fpRate)} (gate < 5%)`);
  console.log(`    false-negative:   ${pct(summary.fnRate)}`);
  console.log(
    `    seeded caught:    ${summary.seededCaughtRate === null ? 'n/a' : pct(summary.seededCaughtRate)}`,
  );
  const ok = summary.passed && errors.length === 0;
  console.log(`\n    ${ok ? 'PASS' : 'FAIL'}\n`);
  process.exit(ok ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
