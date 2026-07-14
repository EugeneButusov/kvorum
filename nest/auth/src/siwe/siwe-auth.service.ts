import { SiweMessage } from 'siwe';
import type { NonceStore } from './nonce.store';
import type { SiweConfig } from './siwe.config';

export type SiweVerifyResult =
  | { ok: true; address: string }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'replayed_nonce' };

// Verifies an EIP-4361 sign-in. Keeps siwe/ethers out of the controller and enforces the two
// security invariants: domain binding (via config, not the request) and single-use nonce.
export class SiweAuthService {
  constructor(
    private readonly config: SiweConfig,
    private readonly nonces: NonceStore,
  ) {}

  async verify(input: { message: string; signature: string }): Promise<SiweVerifyResult> {
    let parsed: SiweMessage;
    try {
      parsed = new SiweMessage(input.message);
    } catch {
      return { ok: false, reason: 'malformed' };
    }

    // Validate the signature + domain binding + issued-at/expiration first, so a bad signature
    // never burns a nonce (nonce spend is DoS-bounded by the per-IP limit instead). siwe v3 REJECTS
    // on any verification failure (signature, domain, expiry), so treat a throw as failure too.
    try {
      const result = await parsed.verify({
        signature: input.signature,
        domain: this.config.domain,
        nonce: parsed.nonce,
      });
      if (!result.success) {
        return { ok: false, reason: 'bad_signature' };
      }
    } catch {
      return { ok: false, reason: 'bad_signature' };
    }

    // Atomically spend the nonce; GETDEL guarantees exactly one verify wins, blocking replay.
    const fresh = await this.nonces.consume(parsed.nonce);
    if (!fresh) {
      return { ok: false, reason: 'replayed_nonce' };
    }

    return { ok: true, address: parsed.address };
  }
}
