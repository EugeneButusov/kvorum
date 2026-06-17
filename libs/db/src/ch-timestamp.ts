// ClickHouse returns DateTime / DateTime64 columns over the HTTP JSON interface as a
// timezone-less UTC string ("YYYY-MM-DD HH:MM:SS[.fff]") — NOT a JS Date. Passing that string
// straight through read rows typed as `Date` makes downstream Date methods (e.g. toISOString)
// throw, and naive `new Date(str)` would parse the space-separated, TZ-less form as LOCAL time
// (shifting the instant by the host offset). This converts the CH string to a correct UTC Date.
// A value that is already a Date (e.g. in unit tests with a mocked CH client) passes through.
export function chTimestampToDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  return new Date(`${value.replace(' ', 'T')}Z`);
}
