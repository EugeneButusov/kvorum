/**
 * A JSON-serializable value. Use this (not `unknown`) for data that round-trips
 * through a `jsonb` column or a JSON wire format — it documents intent and rejects
 * non-serializable values (functions, symbols, Date, bigint) at compile time.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
