export type DecodeErrorReason =
  | 'unknown_topic'
  | 'parse_failed'
  | 'wrong_address'
  | 'wrong_variant';

export class DecodeError extends Error {
  constructor(
    public readonly reason: DecodeErrorReason,
    public readonly decodeSource: unknown,
    public readonly logRef: { txHash: string; logIndex: number; blockHash: string },
  ) {
    super(`decode failed: ${reason}`);
    this.name = 'DecodeError';
  }
}
