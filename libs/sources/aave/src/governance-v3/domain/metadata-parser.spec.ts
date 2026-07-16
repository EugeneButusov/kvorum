import { describe, expect, it } from 'vitest';
import { parseAaveMetadata } from './metadata-parser';

describe('parseAaveMetadata', () => {
  describe('JSON documents (early governor v2 AIPs)', () => {
    it('reads title and description', () => {
      // Shape of the real AIP 5 document (QmVMK…, served as application/json).
      const document = JSON.stringify({
        title: 'AIP 5: Adding CRV to Aave',
        shortDescription: 'Aave governance proposal to enable CRV as a base asset',
        description: '---\naip: 5\ntitle: Adding CRV on AAVE\n---\nBody',
      });

      expect(parseAaveMetadata(document)).toEqual({
        title: 'AIP 5: Adding CRV to Aave',
        description: '---\naip: 5\ntitle: Adding CRV on AAVE\n---\nBody',
      });
    });

    it('falls back to shortDescription when description is absent', () => {
      expect(parseAaveMetadata(JSON.stringify({ title: 'T', shortDescription: 'S' }))).toEqual({
        title: 'T',
        description: 'S',
      });
    });

    it('returns a null title rather than a non-string one', () => {
      expect(parseAaveMetadata(JSON.stringify({ title: 42, description: 'B' }))).toEqual({
        title: null,
        description: 'B',
      });
    });

    it('rejects JSON that is not an object', () => {
      expect(parseAaveMetadata('"just a string"')).toBeNull();
      expect(parseAaveMetadata('123')).toBeNull();
    });
  });

  describe('markdown with YAML front matter (2022+ v2, all governance v3)', () => {
    it('reads the title from front matter and the body as description', () => {
      const document = [
        '---',
        'title: Add 1INCH to Aave v2 market',
        'status: Proposed',
        'shortDescription: Add 1INCH as collateral on the Aave V2 market',
        'created: 2022-07-18',
        '---',
        '',
        '## Simple Summary',
        '',
        'Body.',
      ].join('\n');

      // Front matter wins: the body's first heading is a section name, not the proposal title.
      expect(parseAaveMetadata(document)).toEqual({
        title: 'Add 1INCH to Aave v2 market',
        description: '## Simple Summary\n\nBody.',
      });
    });

    it('falls back to shortDescription when front matter has no title', () => {
      const document = ['---', 'shortDescription: Onboard rETH', '---', 'Body.'].join('\n');

      expect(parseAaveMetadata(document)).toEqual({ title: 'Onboard rETH', description: 'Body.' });
    });

    it('uses shortDescription as the description when the body is empty', () => {
      const document = ['---', 'title: T', 'shortDescription: S', '---', '   '].join('\n');

      expect(parseAaveMetadata(document)).toEqual({ title: 'T', description: 'S' });
    });

    it('handles CRLF line endings', () => {
      const document = '---\r\ntitle: Windows Proposal\r\n---\r\nBody.';

      expect(parseAaveMetadata(document)).toEqual({
        title: 'Windows Proposal',
        description: 'Body.',
      });
    });

    it('strips surrounding quotes from a scalar', () => {
      const document = ['---', 'title: "Quoted: with colon"', '---', 'Body.'].join('\n');

      expect(parseAaveMetadata(document)?.title).toBe('Quoted: with colon');
    });

    it('keeps a value containing a colon intact', () => {
      const document = ['---', 'title: AIP 5: Adding CRV', '---', 'Body.'].join('\n');

      expect(parseAaveMetadata(document)?.title).toBe('AIP 5: Adding CRV');
    });

    it('ignores indented keys nested under another mapping', () => {
      const document = ['---', 'author:', '  title: Not the proposal title', '---', 'Body.'].join(
        '\n',
      );

      expect(parseAaveMetadata(document)).toEqual({ title: null, description: 'Body.' });
    });

    it('returns null title when front matter carries neither title nor shortDescription', () => {
      const document = ['---', 'status: Proposed', '---', 'Body.'].join('\n');

      expect(parseAaveMetadata(document)).toEqual({ title: null, description: 'Body.' });
    });
  });

  it('returns null for a document that is neither shape', () => {
    expect(parseAaveMetadata('just some prose')).toBeNull();
    expect(parseAaveMetadata('')).toBeNull();
    // An unterminated front-matter block is not front matter.
    expect(parseAaveMetadata('---\ntitle: T\nno closing fence')).toBeNull();
  });
});
