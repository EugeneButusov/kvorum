import { render, screen } from '@testing-library/react';

import { Banner } from './banner';
import { Button } from './button';
import { Pill } from './pill';
import { Segmented, SegmentedItem } from './segmented';
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

describe('Segmented', () => {
  // jsdom has no layout, so these assert the two properties that carry the behaviour rather than
  // measuring it. Both have failed silently before: a control that could not wrap pushed half the
  // state filters off a phone screen, and a frame with no border-style computed to 0px.
  function renderSegmented() {
    return render(
      <Segmented type="single" aria-label="Range">
        <SegmentedItem value="7d">7d</SegmentedItem>
        <SegmentedItem value="30d">30d</SegmentedItem>
      </Segmented>,
    );
  }

  it('wraps its segments, so a long option set stays on screen at phone width', () => {
    renderSegmented();
    expect(screen.getByRole('radiogroup', { name: 'Range' })).toHaveClass('flex-wrap');
  });

  it('sets an explicit border style, which the global button reset would otherwise strip', () => {
    // tokens.css has `button { border: 0 }` — that shorthand sets border-style: none, and Tailwind's
    // `border` only sets a width, so without `border-solid` the segment frame disappears entirely.
    renderSegmented();
    expect(screen.getByRole('radio', { name: '7d' })).toHaveClass('border-solid', 'border-line-2');
  });
});
