'use client';

import { useState } from 'react';

import { truncateAddress } from '@/components/ui/identity-chip';
import { Section } from '@/components/ui/section';
import type { ProposalActionView, ProposalDetailView } from '@/lib/proposals/detail';

/**
 * Decoded actions (§6.9). Each row shows the target, the decoded call + arguments in readable form,
 * with raw calldata one click away. Cross-chain payloads (Aave) are grouped by destination chain.
 */
export function ActionsSection({ detail }: { detail: ProposalDetailView }) {
  const groups = groupByChain(detail.actions);
  const multiChain = groups.size > 1;

  return (
    <Section number="04" title="Actions" reference={<span>{detail.actions.length} total</span>}>
      {detail.actions.length === 0 ? (
        <p className="font-mono text-mono-body text-ink-3">
          This proposal carries no on-chain actions.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {[...groups.entries()].map(([chainId, actions]) => (
            <div key={chainId} className="flex flex-col gap-3">
              {multiChain && (
                <h3 className="font-mono text-caption uppercase tracking-[0.06em] text-ink-3">
                  Chain {chainId}
                </h3>
              )}
              {actions.map((action) => (
                <ActionRow key={action.index} action={action} />
              ))}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function ActionRow({ action }: { action: ProposalActionView }) {
  const [showRaw, setShowRaw] = useState(false);
  const fn = action.decodedFunction ?? action.functionSignature;
  const args = formatArguments(action.decodedArguments);

  return (
    <div className="border border-line-3 bg-bg-2 p-3 font-mono text-mono-body">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-caption text-ink-4">#{action.index}</span>
        <span className="text-ink" title={action.targetAddress}>
          {truncateAddress(action.targetAddress)}
        </span>
        <span className="text-accent">{fn ?? 'raw call'}</span>
        {action.valueWei !== '0' && (
          <span className="text-caption text-note-ink">value {action.valueWei} wei</span>
        )}
      </div>

      {args != null && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words border-l-2 border-line-3 pl-3 text-caption text-ink-2">
          {args}
        </pre>
      )}

      <button
        type="button"
        onClick={() => setShowRaw((v) => !v)}
        aria-expanded={showRaw}
        className="mt-2 text-caption text-ink-3 underline-offset-2 hover:text-accent hover:underline"
      >
        {showRaw ? 'Hide calldata' : 'Show calldata'}
      </button>
      {showRaw && (
        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all border border-line-3 bg-bg-3 p-2 text-caption text-ink-3">
          {action.calldata}
        </pre>
      )}
    </div>
  );
}

function groupByChain(actions: ProposalActionView[]): Map<string, ProposalActionView[]> {
  const groups = new Map<string, ProposalActionView[]>();
  for (const action of actions) {
    const existing = groups.get(action.targetChainId);
    if (existing) existing.push(action);
    else groups.set(action.targetChainId, [action]);
  }
  return groups;
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
