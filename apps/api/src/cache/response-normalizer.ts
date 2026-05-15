export interface ResponseNormalizer {
  normalize<T>(body: T): T;
}

export const RESPONSE_NORMALIZER = Symbol('RESPONSE_NORMALIZER');

export class IdentityResponseNormalizer implements ResponseNormalizer {
  normalize<T>(body: T): T {
    return body;
  }
}
