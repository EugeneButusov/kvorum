// Easy Track title rule (ADR-030, ADR-076). Motion events carry no human title — a motion's intent
// lives in its EVMScript/factory, decoded in the follow-up that adds proposal actions. Until then the
// title is a deterministic placeholder keyed on the motion id, mirroring the Aragon `Lido Vote #{id}`
// fallback so the proposal surface stays populated and stable.
export function easyTrackMotionTitle(motionId: string): string {
  return `Easy Track motion #${motionId}`;
}
