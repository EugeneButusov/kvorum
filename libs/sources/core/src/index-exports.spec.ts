import { describe, expect, it } from 'vitest';
import {
  SOURCE_PLUGINS,
  SOURCE_INGESTERS,
  DERIVATION_APPLIERS,
  ACTOR_SWEEP_ADAPTERS,
  readCalldataDecoderConfig,
  ChainNotReadyError,
  BootCatchUpShutdownError,
  DaoSourceNotFoundError,
  BackfillAlreadyStartedError,
  BackfillNotResumableError,
} from './index';

describe('index barrel exports', () => {
  it('exports injection token constants', () => {
    expect(SOURCE_PLUGINS).toBe('SOURCE_PLUGINS');
    expect(SOURCE_INGESTERS).toBe('SOURCE_INGESTERS');
    expect(DERIVATION_APPLIERS).toBe('DERIVATION_APPLIERS');
    expect(ACTOR_SWEEP_ADAPTERS).toBe('ACTOR_SWEEP_ADAPTERS');
  });

  it('readCalldataDecoderConfig returns config with etherscan defaults', () => {
    const config = readCalldataDecoderConfig();
    expect(config).toHaveProperty('etherscan');
    expect(typeof config.etherscan.enabled).toBe('boolean');
  });

  it('ChainNotReadyError is constructible and has correct name', () => {
    const err = new ChainNotReadyError('0x1');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ChainNotReadyError');
    expect(err.message).toContain('0x1');
  });

  it('BootCatchUpShutdownError is constructible', () => {
    const err = new BootCatchUpShutdownError();
    expect(err).toBeInstanceOf(Error);
  });

  it('DaoSourceNotFoundError is constructible', () => {
    const err = new DaoSourceNotFoundError('src-1');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('src-1');
  });

  it('BackfillAlreadyStartedError is constructible', () => {
    const err = new BackfillAlreadyStartedError('src-1');
    expect(err).toBeInstanceOf(Error);
  });

  it('BackfillNotResumableError is constructible', () => {
    const err = new BackfillNotResumableError('src-1');
    expect(err).toBeInstanceOf(Error);
  });
});
