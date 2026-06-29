import { describe, expect, it } from 'vitest';
import { easyTrackMotionTitle } from './title-extractor';

describe('easyTrackMotionTitle', () => {
  it('renders a deterministic placeholder keyed on the motion id', () => {
    expect(easyTrackMotionTitle('42')).toBe('Easy Track motion #42');
    expect(easyTrackMotionTitle('1')).toBe('Easy Track motion #1');
  });
});
