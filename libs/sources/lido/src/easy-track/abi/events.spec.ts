import { describe, expect, it } from 'vitest';
import { EASY_TRACK_INTERFACE, EASY_TRACK_TOPICS } from './events';

describe('EASY_TRACK_TOPICS', () => {
  const events = [
    'MotionCreated',
    'MotionObjected',
    'MotionRejected',
    'MotionCanceled',
    'MotionEnacted',
    'MotionDurationChanged',
    'ObjectionsThresholdChanged',
    'MotionsCountLimitChanged',
    'EVMScriptExecutorChanged',
  ] as const;

  it('has 9 unique topic hashes', () => {
    const hashes = Object.values(EASY_TRACK_TOPICS);
    expect(hashes).toHaveLength(9);
    expect(new Set(hashes).size).toBe(9);
  });

  it.each(events)('%s topic matches the interface fragment', (name) => {
    const fragment = EASY_TRACK_INTERFACE.getEvent(name);
    expect(fragment).not.toBeNull();
    expect(EASY_TRACK_TOPICS[name]).toBe(fragment!.topicHash.toLowerCase());
  });

  it('all topics start with 0x and are 66 chars', () => {
    for (const hash of Object.values(EASY_TRACK_TOPICS)) {
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  // Locked against the deployed mainnet EasyTrack 0xF0211b… (verified ABI). A drift here means the
  // vendored signatures diverged from the on-chain contract — fail loudly rather than silently
  // mis-decode. MotionCreated / MotionEnacted were additionally confirmed against real emitted logs.
  it('matches the on-chain topic0 hashes', () => {
    expect(EASY_TRACK_TOPICS).toEqual({
      MotionCreated: '0x2775db1f1f2dd97c60ba2903b3ca235c9cecb3cb47a9cb464f86578b9877f4a4',
      MotionObjected: '0xa64d606df8b3e72e8f53ac4185170bbd4348d0ee03c2cfceadeafc2b316c3e6b',
      MotionRejected: '0x6a4120e111f0bfb3586b7dc9317f9ae5441ce866d1ad9d221ce6d76431f84426',
      MotionCanceled: '0x801fcb98a9fa2e695209772f0a24f3f7ac36f6568659ae2e0cd7763fb73f2862',
      MotionEnacted: '0xd4fbbd7bf63590ce72807eb770b83aaf2f3a7958a4b2093fd9ab89b276096942',
      MotionDurationChanged: '0x03765c4aa18fde3bfe4015073c2b138ce5a02536dd88ceae9739d3e0dbad5d0e',
      ObjectionsThresholdChanged:
        '0xd60715ce58337415334d06256811f30ed8db120287970870d8505e5ed9074c60',
      MotionsCountLimitChanged:
        '0x5e368703b7ab35fe9ef4dbc482cd414476841204c7484b8e834d0d3ac4ed8672',
      EVMScriptExecutorChanged:
        '0x5ed6ba59d23ef79b1a31c9f04da9f879ef6cdb89ad0241716ebdc1f02f5f465a',
    });
  });
});
