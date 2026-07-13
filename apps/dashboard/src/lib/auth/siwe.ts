import { SiweMessage } from 'siwe';

import { fetchNonce, verifySiwe, type Session } from './client';

// Shown to the user in their wallet as the reason for signing. EIP-4361 statement line.
export const SIWE_STATEMENT = 'Sign in to Kvorum to manage your API keys. This does not cost gas.';

export type BuildMessageArgs = {
  address: string;
  chainId: number;
  nonce: string;
  /**
   * Must equal the backend's SIWE_DOMAIN (domain binding is verified first). In the browser this
   * is window.location.host; injected here so the builder stays pure/testable.
   */
  domain: string;
  uri: string;
  issuedAt: string;
};

/** Builds the EIP-4361 message string. Pure — the caller supplies host/origin/time. */
export function buildSiweMessage(args: BuildMessageArgs): string {
  return new SiweMessage({
    domain: args.domain,
    address: args.address,
    statement: SIWE_STATEMENT,
    uri: args.uri,
    version: '1',
    chainId: args.chainId,
    nonce: args.nonce,
    issuedAt: args.issuedAt,
  }).prepareMessage();
}

export type SignFn = (args: { message: string }) => Promise<string>;

/**
 * Runs the full SIWE handshake: fetch a single-use nonce, build + sign the message, verify it
 * server-side (which establishes the session cookie). Wallet interaction is injected via `sign`
 * (wagmi's signMessageAsync) so this stays UI-framework-agnostic.
 */
export async function runSiweLogin(args: {
  address: string;
  chainId: number;
  sign: SignFn;
  email?: string;
}): Promise<Session & { address: string }> {
  const nonce = await fetchNonce();
  const message = buildSiweMessage({
    address: args.address,
    chainId: args.chainId,
    nonce,
    domain: window.location.host,
    uri: window.location.origin,
    issuedAt: new Date().toISOString(),
  });
  const signature = await args.sign({ message });
  return verifySiwe({ message, signature, email: args.email });
}
