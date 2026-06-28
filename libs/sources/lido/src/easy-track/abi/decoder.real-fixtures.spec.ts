import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LogEvent } from '@libs/chain';
import { decodeEasyTrackLog } from './decoder';

// Real on-chain Easy Track logs (verbatim topics + data from mainnet) — proves decodeEasyTrackLog
// against bytes the contract actually emitted, not just ethers' own re-encoding. The fixtures were
// captured from the deployed EasyTrack 0xF0211b… via eth.blockscout.com; see __fixtures__/real-logs.json.

interface RealLog {
  event: string;
  txHash: string;
  blockNumber: number;
  topics: string[];
  data: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(
  readFileSync(join(here, '__fixtures__/real-logs.json'), 'utf8'),
) as Record<string, RealLog>;

function toLogEvent(f: RealLog): LogEvent {
  return {
    sourceType: 'easy_track',
    chainId: '0x1',
    blockNumber: BigInt(f.blockNumber),
    blockHash: '0x' + '00'.repeat(32),
    txHash: f.txHash,
    txIndex: 0,
    logIndex: 0,
    address: '0xf0211b7660680b49de1a7e9f25c65660f0a13fea',
    topics: f.topics,
    data: f.data,
  };
}

describe('decodeEasyTrackLog — real on-chain bytes', () => {
  it('decodes a real MotionEnacted (motion 1046)', () => {
    const decoded = decodeEasyTrackLog(toLogEvent(fixtures['MotionEnacted']!), 'easy_track');
    expect(decoded).toEqual({ type: 'MotionEnacted', payload: { motionId: '1046' } });
  });

  it('decodes a real MotionCreated (motion 1049) with its factory + raw EVMScript', () => {
    const decoded = decodeEasyTrackLog(toLogEvent(fixtures['MotionCreated']!), 'easy_track');
    expect(decoded.type).toBe('MotionCreated');
    if (decoded.type !== 'MotionCreated') return;
    expect(decoded.payload.motionId).toBe('1049');
    // Indexed factory (topic) decoded + lowercased.
    expect(decoded.payload.evmScriptFactory).toBe('0xfebd8fac16de88206d4b18764e826af38546afe0');
    // Non-indexed creator decoded from the data tail.
    expect(decoded.payload.creator).toMatch(/^0x[0-9a-f]{40}$/);
    // The full EVMScript is carried through verbatim for the later action decoder.
    expect(decoded.payload.evmScript).toMatch(/^0x[0-9a-f]+$/);
    expect(decoded.payload.evmScript.length).toBeGreaterThan(2);
  });
});
