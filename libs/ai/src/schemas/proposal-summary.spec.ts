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

  it('rejects a tldr longer than 400 chars', () => {
    expect(ProposalSummarySchema.safeParse({ ...VALID, tldr: 'x'.repeat(401) }).success).toBe(
      false,
    );
  });

  it('rejects more than 5 key_changes', () => {
    const six = Array.from({ length: 6 }, () => ({
      description: 'c',
      significance: 'low' as const,
    }));
    expect(ProposalSummarySchema.safeParse({ ...VALID, key_changes: six }).success).toBe(false);
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
