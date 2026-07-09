import { render, screen } from '@testing-library/react';

import { Banner } from './banner';
import { Button } from './button';
import { Pill } from './pill';
import { StatePill } from './state-pill';
import { VoteTag } from './vote-tag';

describe('Pill', () => {
  it('defaults to the neutral variant', () => {
    render(<Pill>proposal</Pill>);
    expect(screen.getByText('proposal')).toHaveClass('border-line-2', 'text-ink-2');
  });

  it('tints border + ink per DAO', () => {
    render(<Pill dao="compound">Compound</Pill>);
    expect(screen.getByText('Compound')).toHaveClass(
      'border-dao-compound',
      'text-dao-compound-ink',
    );
  });
});

describe('StatePill', () => {
  it('fills with the active severity', () => {
    render(<StatePill state="active">active</StatePill>);
    expect(screen.getByText('active')).toHaveClass('bg-primary', 'border-primary', 'text-bg-2');
  });

  it('renders the draft outline treatment', () => {
    render(<StatePill state="draft">draft</StatePill>);
    expect(screen.getByText('draft')).toHaveClass('border-line-2', 'bg-bg-2', 'text-ink-3');
  });
});

describe('VoteTag', () => {
  it.each([
    ['for', 'bg-vote-for'],
    ['against', 'bg-vote-against'],
    ['abstain', 'bg-transparent'],
  ] as const)('maps choice %s to its fill', (choice, cls) => {
    render(<VoteTag choice={choice}>{choice}</VoteTag>);
    expect(screen.getByText(choice)).toHaveClass(cls);
  });
});

describe('Banner', () => {
  it('applies severity classes and renders the glyph', () => {
    render(
      <Banner severity="warn" glyph="!">
        mismatch
      </Banner>,
    );
    expect(screen.getByText('mismatch').parentElement).toHaveClass('border-warn', 'bg-warn-bg');
    expect(screen.getByText('!')).toHaveClass('bg-warn', 'text-warn-bg');
  });
});

describe('Button', () => {
  it('renders a <button> by default with the default variant', () => {
    render(<Button>Go</Button>);
    const el = screen.getByRole('button', { name: 'Go' });
    expect(el.tagName).toBe('BUTTON');
    expect(el).toHaveClass('bg-primary', 'text-primary-foreground');
  });

  it('renders as its child when asChild is set', () => {
    render(
      <Button asChild>
        <a href="/x">Link</a>
      </Button>,
    );
    const el = screen.getByRole('link', { name: 'Link' });
    expect(el.tagName).toBe('A');
    expect(el).toHaveClass('bg-primary');
  });
});
