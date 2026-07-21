import { describe, expect, it } from 'vitest';
import {
  PROPOSAL_SUMMARY_SIGNALING_TEMPLATE,
  PROPOSAL_SUMMARY_TEMPLATE,
} from './proposal-summary-template.js';
import { render } from './renderer.js';
import { ProposalSummarySchema } from '../schemas/proposal-summary.js';

describe('PROPOSAL_SUMMARY_TEMPLATE', () => {
  it('has the pinned frontmatter and the summarizer schema', () => {
    expect(PROPOSAL_SUMMARY_TEMPLATE.name).toBe('proposal_summarizer');
    expect(PROPOSAL_SUMMARY_TEMPLATE.version).toBe('v1.0');
    expect(PROPOSAL_SUMMARY_TEMPLATE.model).toBe('claude-haiku-4-5');
    expect(PROPOSAL_SUMMARY_TEMPLATE.schema).toBe(ProposalSummarySchema);
  });

  it('renders both placeholders and yields a canonical inputContent', () => {
    const rendered = render(PROPOSAL_SUMMARY_TEMPLATE, {
      description: 'Raise the reserve factor.',
      decoded_actions: '[]',
    });
    expect(rendered.feature).toBe('proposal_summarizer');
    expect(rendered.promptVersion).toBe('v1.0');
    expect(rendered.messages[0]?.content).toContain('Raise the reserve factor.');
    expect(rendered.messages[0]?.content).toContain('[]');
    // canonical vars JSON, keys sorted: decoded_actions before description
    expect(rendered.inputContent).toBe(
      JSON.stringify({ decoded_actions: '[]', description: 'Raise the reserve factor.' }),
    );
  });
});

describe('PROPOSAL_SUMMARY_SIGNALING_TEMPLATE', () => {
  it('is a distinct template name that shares the proposal_summarizer feature', () => {
    expect(PROPOSAL_SUMMARY_SIGNALING_TEMPLATE.name).toBe('proposal_summarizer_signaling');
    expect(PROPOSAL_SUMMARY_SIGNALING_TEMPLATE.feature).toBe('proposal_summarizer');
    expect(PROPOSAL_SUMMARY_SIGNALING_TEMPLATE.version).toBe('v1.0');
    expect(PROPOSAL_SUMMARY_SIGNALING_TEMPLATE.model).toBe('claude-haiku-4-5');
    expect(PROPOSAL_SUMMARY_SIGNALING_TEMPLATE.schema).toBe(ProposalSummarySchema);
  });

  it('renders to the shared feature and both placeholders', () => {
    const rendered = render(PROPOSAL_SUMMARY_SIGNALING_TEMPLATE, {
      description: 'Should we allocate to a growth fund?',
      decoded_actions: '[]',
    });
    // decoupled: name is the signaling variant, feature rolls up to proposal_summarizer
    expect(rendered.feature).toBe('proposal_summarizer');
    expect(rendered.messages[0]?.content).toContain('Should we allocate to a growth fund?');
  });
});
