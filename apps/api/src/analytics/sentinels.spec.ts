import { delegateActorIdFromCh, primaryChoiceFromCh, ZERO_UUID } from './sentinels';

describe('sentinels', () => {
  it('maps primary_choice sentinel to null', () => {
    expect(primaryChoiceFromCh(-1)).toBeNull();
    expect(primaryChoiceFromCh(2)).toBe(2);
  });

  it('maps zero uuid delegate to null', () => {
    expect(delegateActorIdFromCh(ZERO_UUID)).toBeNull();
    expect(delegateActorIdFromCh('11111111-1111-1111-1111-111111111111')).toBe(
      '11111111-1111-1111-1111-111111111111',
    );
  });
});
