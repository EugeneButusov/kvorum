// Re-export of the canonical seconds-precision ISO helpers (@libs/db). Kept as a local alias so the
// mappers' import path stays stable and `toIsoDate` reads naturally at the call site.
export { isoSeconds, isoSecondsRequired as toIsoDate } from '@libs/db';
