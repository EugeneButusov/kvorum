import { KEY_PREFIX, parseBearerToken } from './bearer';

describe('parseBearerToken', () => {
  it('parses a valid bearer key', () => {
    const body = 'aB01_-aB01_-aB01_-aB01_-aB01_-aB';
    const key = `${KEY_PREFIX}${body}`;

    expect(parseBearerToken(`Bearer ${key}`)).toEqual({
      key,
      prefix: KEY_PREFIX,
    });
  });

  it('returns null for missing header', () => {
    expect(parseBearerToken(undefined)).toBeNull();
  });

  it('returns null for wrong scheme', () => {
    const key = `${KEY_PREFIX}aB01_-aB01_-aB01_-aB01_-aB01_-aB`;
    expect(parseBearerToken(`Basic ${key}`)).toBeNull();
  });

  it('returns null for an unknown prefix', () => {
    expect(parseBearerToken('Bearer kv_test_aB01_-aB01_-aB01_-aB01_-aB01_-aB')).toBeNull();
  });

  it('returns null for wrong key length', () => {
    expect(parseBearerToken(`Bearer ${KEY_PREFIX}${'a'.repeat(31)}`)).toBeNull();
    expect(parseBearerToken(`Bearer ${KEY_PREFIX}${'a'.repeat(33)}`)).toBeNull();
  });

  it('returns null for illegal characters', () => {
    expect(parseBearerToken(`Bearer ${KEY_PREFIX}${'a'.repeat(31)}+`)).toBeNull();
    expect(parseBearerToken(`Bearer ${KEY_PREFIX}${'a'.repeat(31)}/`)).toBeNull();
    expect(parseBearerToken(`Bearer ${KEY_PREFIX}${'a'.repeat(31)} `)).toBeNull();
  });
});
