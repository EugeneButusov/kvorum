import { Wallet } from 'ethers';
import { SiweMessage } from 'siwe';
import type { NonceStore } from './nonce.store';
import { SiweAuthService } from './siwe-auth.service';
import type { SiweConfig } from './siwe.config';

const DOMAIN = 'localhost:3000';
// Fixed test key → deterministic address, no randomness.
const WALLET = new Wallet(`0x${'1'.repeat(64)}`);

async function signIn(overrides?: {
  domain?: string;
  nonce?: string;
}): Promise<{ message: string; signature: string }> {
  const siwe = new SiweMessage({
    domain: overrides?.domain ?? DOMAIN,
    address: WALLET.address,
    statement: 'Sign in to Kvorum',
    uri: `https://${DOMAIN}`,
    version: '1',
    chainId: 1,
    nonce: overrides?.nonce ?? 'abcd1234efgh',
    issuedAt: new Date().toISOString(),
  });
  const message = siwe.prepareMessage();
  const signature = await WALLET.signMessage(message);
  return { message, signature };
}

function makeService(consume: () => Promise<boolean>): SiweAuthService {
  const config: SiweConfig = { domain: DOMAIN };
  const nonces = { consume: async () => consume() } as unknown as NonceStore;
  return new SiweAuthService(config, nonces);
}

describe('SiweAuthService', () => {
  it('verifies a valid sign-in and returns the checksummed address', async () => {
    const service = makeService(async () => true);
    const { message, signature } = await signIn();

    const result = await service.verify({ message, signature });
    expect(result).toEqual({ ok: true, address: WALLET.address });
  });

  it('rejects a tampered signature', async () => {
    const service = makeService(async () => true);
    const { message, signature } = await signIn();
    // Flip the last character of the signature.
    const tampered = `${signature.slice(0, -1)}${signature.endsWith('0') ? '1' : '0'}`;

    const result = await service.verify({ message, signature: tampered });
    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a domain mismatch (binding)', async () => {
    const service = makeService(async () => true);
    // Message bound to a different domain than the service's configured domain.
    const { message, signature } = await signIn({ domain: 'evil.example.com' });

    const result = await service.verify({ message, signature });
    expect(result.ok).toBe(false);
  });

  it('rejects a replayed / already-consumed nonce even with a valid signature', async () => {
    const service = makeService(async () => false); // nonce no longer present
    const { message, signature } = await signIn();

    const result = await service.verify({ message, signature });
    expect(result).toEqual({ ok: false, reason: 'replayed_nonce' });
  });

  it('rejects a malformed message', async () => {
    const service = makeService(async () => true);
    const result = await service.verify({ message: 'not a siwe message', signature: '0xdead' });
    expect(result).toEqual({ ok: false, reason: 'malformed' });
  });
});
