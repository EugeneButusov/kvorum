import type { Interface, FunctionFragment } from 'ethers';

export interface AbiEntry {
  iface: Interface;
  fragment: FunctionFragment;
  sourceName: string;
}

export interface LoadedAbiLibrary {
  /** selector (lowercase, with 0x prefix) → list of candidate entries (collision-safe). */
  bySelector: ReadonlyMap<string, readonly AbiEntry[]>;
}
