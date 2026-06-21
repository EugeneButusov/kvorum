export function singleChoiceBreakdown(primaryChoice: number): string {
  return JSON.stringify([{ choice_index: primaryChoice, weight: '1.0' }]);
}
