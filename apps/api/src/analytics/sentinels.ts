export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export function primaryChoiceFromCh(value: number): number | null {
  return value === -1 ? null : value;
}

export function delegateActorIdFromCh(value: string | null): string | null {
  return value === null || value === ZERO_UUID ? null : value;
}
