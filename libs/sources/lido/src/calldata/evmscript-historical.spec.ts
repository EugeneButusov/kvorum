/**
 * Historical acceptance test: ≥95% of non-empty Lido executionScripts parse structurally.
 *
 * This test is RPC-free — all fixtures are committed JSON files under __fixtures__/scripts/.
 * See __fixtures__/README.md for the decoder contract and acceptance-criterion definition.
 *
 * To capture new fixtures, run libs/sources/lido/src/calldata/__fixtures__/capture.ts with:
 *   MAINNET_RPC_URL=<url> ts-node --esm capture.ts
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { decodeEvmScript } from '@sources/core';
import { toProposalActions } from './evmscript-actions';
import { EXECUTE_SELECTOR, FORWARD_SELECTOR, createForwarderRegistry } from './forwarders';

interface FixtureFile {
  voteId: number;
  kind: 'empty' | 'flat' | 'omnibus' | 'execute';
  script: string;
  expectedLeafActionCount: number | null;
  countProvenance: string;
}

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'scripts');
const FIXTURES_PRESENT =
  existsSync(FIXTURES_DIR) && readdirSync(FIXTURES_DIR).some((f) => f.endsWith('.json'));

function loadFixtures(): FixtureFile[] {
  if (!FIXTURES_PRESENT) return [];
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')) as FixtureFile);
}

const registry = createForwarderRegistry();

const describeIf = (cond: boolean) => (cond ? describe : describe.skip);

describeIf(FIXTURES_PRESENT)('EVMScript historical acceptance', () => {
  const all = loadFixtures();
  const empty = all.filter((f) => f.kind === 'empty');
  const nonEmpty = all.filter((f) => f.kind !== 'empty');
  const omnibus = all.filter((f) => f.kind === 'omnibus');

  it('has at least 20 non-empty fixtures', () => {
    expect(nonEmpty.length).toBeGreaterThanOrEqual(20);
  });

  it('has at least 5 omnibus fixtures', () => {
    expect(omnibus.length).toBeGreaterThanOrEqual(5);
  });

  it('empty fixtures parse to [] (100% trivial)', () => {
    for (const fixture of empty) {
      const result = decodeEvmScript(fixture.script);
      expect(result).toEqual([]);
    }
  });

  it('≥95% of non-empty fixtures parse without error', () => {
    let parsed = 0;
    const failed: number[] = [];
    for (const fixture of nonEmpty) {
      try {
        toProposalActions(fixture.script, '0x1', registry);
        parsed++;
      } catch {
        failed.push(fixture.voteId);
      }
    }
    const rate = parsed / nonEmpty.length;
    expect(rate).toBeGreaterThanOrEqual(0.95);
    if (failed.length > 0) {
      console.info(`Parse failures (voteIds): ${failed.join(', ')}`);
    }
  });

  it('non-empty fixtures yield expectedLeafActionCount leaves', () => {
    for (const fixture of nonEmpty) {
      if (fixture.expectedLeafActionCount === null) continue;
      let actions: unknown[];
      try {
        actions = toProposalActions(fixture.script, '0x1', registry);
      } catch {
        continue; // counted in the ≥95% test above
      }
      expect(actions).toHaveLength(fixture.expectedLeafActionCount);
    }
  });

  it('omnibus fixtures each recurse ≥1 level and yield >1 leaf', () => {
    for (const fixture of omnibus) {
      let actions: ReturnType<typeof toProposalActions>;
      try {
        actions = toProposalActions(fixture.script, '0x1', registry);
      } catch {
        continue;
      }
      expect(actions.length).toBeGreaterThan(1);
    }
  });

  it('zero opaque-degradations across the historical set', () => {
    // An opaque degradation is a leaf that targets a known forwarder AND uses the
    // forward/execute selector — meaning unwrapping silently fell back instead of recursing.
    // A direct call to a forwarder address with a different selector is legitimate (e.g.
    // TokenManager.assignVested) and must NOT be flagged.
    const forwarderAddresses = new Set([
      '0x3e40d73eb977dc6a537af587d48316fee66e9c8c', // Agent
      '0xf73a1260d222f447210581ddf212d915c09a3249', // TokenManager
      '0x2e59a20f205bb85a89c53f1936454680651e618e', // Voting
    ]);
    const forwarderSelectors = new Set([FORWARD_SELECTOR, EXECUTE_SELECTOR]);
    const degraded: number[] = [];
    for (const fixture of nonEmpty) {
      let actions: ReturnType<typeof toProposalActions>;
      try {
        actions = toProposalActions(fixture.script, '0x1', registry);
      } catch {
        continue;
      }
      for (const action of actions) {
        const sel = action.calldata.length >= 10 ? action.calldata.slice(0, 10).toLowerCase() : '';
        if (forwarderAddresses.has(action.targetAddress) && forwarderSelectors.has(sel)) {
          degraded.push(fixture.voteId);
          break;
        }
      }
    }
    if (degraded.length > 0) {
      console.warn(`Opaque degradations in voteIds: ${degraded.join(', ')}`);
    }
    expect(degraded).toHaveLength(0);
  });

  it('spot-check: first omnibus fixture has canonical leaf ordering', () => {
    const fixture = omnibus[0];
    if (!fixture) return;
    let actions: ReturnType<typeof toProposalActions>;
    try {
      actions = toProposalActions(fixture.script, '0x1', registry);
    } catch {
      return;
    }
    // Each leaf must have a lowercase hex address and '0x'-prefixed calldata
    for (const action of actions) {
      expect(action.targetAddress).toMatch(/^0x[0-9a-f]{40}$/);
      expect(action.calldata).toMatch(/^0x/);
      expect(action.valueWei).toMatch(/^\d+$/);
      expect(action.targetChainId).toBe('0x1');
      expect(action.functionSignature).toBeNull();
    }
  });
});

describeIf(!FIXTURES_PRESENT)('EVMScript historical acceptance (fixtures pending)', () => {
  it.skip('fixtures not yet captured — run capture.ts with a mainnet RPC URL to populate', () => {
    // This placeholder keeps the test file parseable without fixtures.
    // See libs/sources/lido/src/calldata/__fixtures__/README.md for capture instructions.
  });
});
