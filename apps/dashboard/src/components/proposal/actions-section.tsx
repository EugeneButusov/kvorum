'use client';

import { useState } from 'react';

import { Section } from '@/components/ui/section';
import { truncateAddress } from '@/lib/format';
import type { ProposalActionView, ProposalDetailView } from '@/lib/proposals/detail';

const CHAIN_NAMES: Record<string, string> = {
  '1': 'ethereum',
  '10': 'optimism',
  '100': 'gnosis',
  '137': 'polygon',
  '8453': 'base',
  '42161': 'arbitrum',
  '43114': 'avalanche',
};

function chainLabel(chainId: string): string {
  const name = CHAIN_NAMES[chainId];
  return name ? `chain ${chainId} · ${name}` : `chain ${chainId}`;
}

/**
 * Decoded actions (§6.9). Each action is a card: a header with the decoded call + destination chain,
 * then labelled field rows (target, value, function, arguments) with the raw calldata one click away.
 */
export function ActionsSection({ detail }: { detail: ProposalDetailView }) {
  const actions = detail.actions;

  return (
    <Section number="04" title="Actions" reference={<span>{actions.length} total</span>}>
      {actions.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">
          This proposal carries no on-chain actions.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {actions.map((action) => (
            <ActionCard key={action.index} action={action} />
          ))}
        </div>
      )}
    </Section>
  );
}

function ActionCard({ action }: { action: ProposalActionView }) {
  const [showRaw, setShowRaw] = useState(false);
  const fn = action.decodedFunction ?? action.functionSignature ?? 'raw call';
  const args = formatArguments(action.decodedArguments);

  return (
    <div className="border border-line-3 bg-bg-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-3 bg-bg px-3.5 py-2.5">
        <span className="border border-line-2 px-2 py-0.5 font-mono text-mono-body text-ink-2">
          #{action.index}
        </span>
        <span className="font-mono text-body font-semibold text-ink">{fn}</span>
        <span className="ml-auto font-mono text-pill uppercase tracking-[0.06em] text-ink-3">
          {chainLabel(action.targetChainId)}
        </span>
      </div>
      <dl className="flex flex-col">
        <FieldRow label="Target">
          <span className="break-all" title={action.targetAddress}>
            {truncateAddress(action.targetAddress)}
          </span>
        </FieldRow>
        <FieldRow label="Value">{action.valueWei} wei</FieldRow>
        <FieldRow label="Function">{fn}</FieldRow>
        {args != null && (
          <FieldRow label="Arguments">
            <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all">{args}</pre>
          </FieldRow>
        )}
        <FieldRow label="Calldata">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              aria-expanded={showRaw}
              className="self-start text-ink-3 underline-offset-2 hover:text-primary hover:underline"
            >
              {showRaw ? 'Hide raw calldata' : 'Show raw calldata'}
            </button>
            {showRaw && (
              <pre className="overflow-x-auto whitespace-pre-wrap break-all border border-line-3 bg-bg-3 p-2 text-ink-3">
                {action.calldata}
              </pre>
            )}
          </div>
        </FieldRow>
      </dl>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-dashed border-line-3 px-3.5 py-2 last:border-b-0">
      <dt className="font-mono text-caption uppercase tracking-[0.08em] text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-dense text-ink">{children}</dd>
    </div>
  );
}

function formatArguments(args: unknown): string | null {
  if (args == null) return null;
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return null;
  }
}
