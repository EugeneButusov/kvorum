import { HttpException } from '@nestjs/common';
import { PROBLEM_META, type ProblemSlug } from './problem-types';

export type ProblemViolation = {
  field: string;
  message: string;
};

type ProblemExceptionOptions = {
  detail?: string;
  violations?: ProblemViolation[];
};

export class ProblemException extends HttpException {
  readonly slug: ProblemSlug;
  readonly detail?: string;
  readonly violations?: ProblemViolation[];

  constructor(slug: ProblemSlug, status: number, detail?: string, violations?: ProblemViolation[]) {
    super(detail ?? PROBLEM_META[slug].title, status);
    this.slug = slug;
    this.detail = detail;
    this.violations = violations;
  }
}

export function badRequestProblem(
  slug: ProblemSlug,
  violations: ProblemViolation[],
  detail?: string,
): ProblemException {
  return new ProblemException(slug, 400, detail, violations);
}

export function problemException(
  slug: ProblemSlug,
  opts: ProblemExceptionOptions = {},
): ProblemException {
  return new ProblemException(slug, PROBLEM_META[slug].defaultStatus, opts.detail, opts.violations);
}
