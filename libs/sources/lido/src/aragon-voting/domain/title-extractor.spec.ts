import { describe, expect, it } from 'vitest';
import { extractAragonTitle } from './title-extractor';

describe('extractAragonTitle', () => {
  it('takes the first non-empty line of a Lido omnibus metadata string', () => {
    const metadata = 'Omnibus vote: do thing A;\n do thing B;\n lidovoteipfs://bafyfoo';
    expect(extractAragonTitle(metadata, '170')).toBe('Omnibus vote: do thing A;');
  });

  it('strips a leading markdown # and surrounding whitespace', () => {
    expect(extractAragonTitle('\n\n  # Real title\nBody', '12')).toBe('Real title');
  });

  it('uses a bare description string as the title', () => {
    expect(extractAragonTitle('Simple parametric vote', '3')).toBe('Simple parametric vote');
  });

  it('falls back to a placeholder for empty metadata', () => {
    expect(extractAragonTitle('', '5')).toBe('Lido Vote #5');
  });

  it('falls back to a placeholder when metadata is only an IPFS CID', () => {
    expect(extractAragonTitle('lidovoteipfs://bafyonlycid', '200')).toBe('Lido Vote #200');
  });

  it('truncates over-long titles to 200 chars with an ellipsis', () => {
    const long = 'x'.repeat(250);
    const title = extractAragonTitle(long, '9');
    expect(title).toHaveLength(200);
    expect(title.endsWith('…')).toBe(true);
  });
});
