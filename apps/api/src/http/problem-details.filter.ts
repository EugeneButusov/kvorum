import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { ProblemException, type ProblemViolation } from './problem-exception';
import { PROBLEM_META, problemType, slugFromHttpStatus, type ProblemSlug } from './problem-types';

type ProblemBody = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  violations?: ProblemViolation[];
};

@Catch()
@Injectable()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    if (res.headersSent) {
      return;
    }

    const body = this.toProblemBody(exception, req.path);
    res.status(body.status);
    res.setHeader('Content-Type', 'application/problem+json');
    res.json(body);
  }

  private toProblemBody(exception: unknown, instance: string): ProblemBody {
    if (exception instanceof ProblemException) {
      const title = PROBLEM_META[exception.slug].title;
      return {
        type: problemType(exception.slug),
        title,
        status: exception.getStatus(),
        detail: exception.detail ?? title,
        instance,
        violations: exception.violations,
      };
    }

    if (exception instanceof ZodError) {
      const slug: ProblemSlug = 'validation';
      const title = PROBLEM_META[slug].title;
      return {
        type: problemType(slug),
        title,
        status: 400,
        detail: title,
        instance,
        violations: exception.issues.map((issue) => ({
          field: issue.path.length === 0 ? '(root)' : issue.path.join('.'),
          message: issue.message,
        })),
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const slug = slugFromHttpStatus(status);
      const title = PROBLEM_META[slug].title;
      const detail =
        status >= 500 ? 'An unexpected error occurred.' : this.detailFromHttpException(exception);

      if (status >= 500) {
        this.logger.error(exception.message, exception.stack);
      }

      return {
        type: problemType(slug),
        title,
        status,
        detail: detail ?? title,
        instance,
      };
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : undefined,
    );

    return {
      type: problemType('internal-error'),
      title: PROBLEM_META['internal-error'].title,
      status: 500,
      detail: 'An unexpected error occurred.',
      instance,
    };
  }

  private detailFromHttpException(exception: HttpException): string | undefined {
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return response;
    }

    if (typeof response === 'object' && response !== null && 'message' in response) {
      const message = (response as { message: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }

    return exception.message;
  }
}
