import { describe, expect, it } from 'vitest';
import { ProposalSummarySchema, PROPOSAL_SUMMARY_SCHEMA_NAME } from './proposal-summary.js';

const VALID = {
  tldr: 'Raises the USDC reserve factor from 10% to 15%.',
  proposal_type: 'parameter_change' as const,
  proposal_type_confidence: 'high' as const,
  affected_contracts: ['0xabc'],
  key_changes: [{ description: 'reserve factor 10%→15%', significance: 'high' as const }],
  funding_amount_usd: null,
};

describe('ProposalSummarySchema', () => {
  it('accepts a valid summary and infers optional fields as absent', () => {
    const parsed = ProposalSummarySchema.parse(VALID);
    expect(parsed.tldr).toContain('reserve factor');
    expect(parsed.beneficiaries).toBeUndefined();
  });

  it('rejects an unknown proposal_type', () => {
    expect(ProposalSummarySchema.safeParse({ ...VALID, proposal_type: 'nonsense' }).success).toBe(
      false,
    );
  });

  it('accepts a tldr in the previously-rejected 400–600 range', () => {
    // Anthropic strips maxLength from the sent schema, so the model overruns the old 400 cap; a
    // slightly-long-but-valid tldr must not be dead-lettered.
    const parsed = ProposalSummarySchema.parse({ ...VALID, tldr: 'x'.repeat(500) });
    expect(parsed.tldr.length).toBe(500);
  });

  it('clamps an over-long tldr instead of rejecting it', () => {
    const parsed = ProposalSummarySchema.parse({ ...VALID, tldr: 'lorem '.repeat(300) });
    expect(parsed.tldr.length).toBeLessThanOrEqual(600);
  });

  it('clamps more than the max key_changes instead of rejecting', () => {
    const twelve = Array.from({ length: 12 }, () => ({
      description: 'c',
      significance: 'low' as const,
    }));
    const parsed = ProposalSummarySchema.parse({ ...VALID, key_changes: twelve });
    expect(parsed.key_changes).toHaveLength(8);
  });

  it('accepts funding_amount_usd as a string', () => {
    expect(
      ProposalSummarySchema.safeParse({ ...VALID, funding_amount_usd: '1000000' }).success,
    ).toBe(true);
  });

  it('exposes the schema-label constant used by the template registry', () => {
    expect(PROPOSAL_SUMMARY_SCHEMA_NAME).toBe('ProposalSummarySchema');
  });
});
