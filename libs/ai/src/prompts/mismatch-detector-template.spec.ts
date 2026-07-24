import { describe, expect, it } from 'vitest';
import { MISMATCH_DETECTOR_TEMPLATE } from './mismatch-detector-template.js';
import { render } from './renderer.js';
import { MismatchAnalysisSchema } from '../schemas/mismatch-analysis.js';

describe('MISMATCH_DETECTOR_TEMPLATE', () => {
  it('has the pinned frontmatter and the mismatch schema', () => {
    expect(MISMATCH_DETECTOR_TEMPLATE.name).toBe('mismatch_detector');
    expect(MISMATCH_DETECTOR_TEMPLATE.version).toBe('v1.0');
    expect(MISMATCH_DETECTOR_TEMPLATE.model).toBe('claude-sonnet-5');
    expect(MISMATCH_DETECTOR_TEMPLATE.schema).toBe(MismatchAnalysisSchema);
  });

  it('renders both placeholders under the mismatch_detector feature', () => {
    const rendered = render(MISMATCH_DETECTOR_TEMPLATE, {
      description: 'Raise the reserve factor to 5%.',
      decoded_actions: '[{"action_index":0,"decoded_function":"setReserveFactor"}]',
    });
    expect(rendered.feature).toBe('mismatch_detector');
    expect(rendered.promptVersion).toBe('v1.0');
    expect(rendered.messages[0]?.content).toContain('Raise the reserve factor to 5%.');
    expect(rendered.messages[0]?.content).toContain('setReserveFactor');
  });
});
