export type OutputFormat = 'human' | 'json';

export enum ExitCode {
  RuntimeFailure = 1,
  ValidationFailure = 2,
  NotFound = 3,
}

export interface FailureDetails {
  [key: string]: unknown;
}

export function resolveFormat(
  commandFormat?: string | undefined,
  globalFormat?: string | undefined,
): OutputFormat {
  const value = commandFormat ?? globalFormat ?? process.env['ADMIN_FORMAT'] ?? 'human';
  if (value === 'human' || value === 'json') {
    return value;
  }

  throw new Error(`invalid --format value: ${value}`);
}

export function emit<T>(format: OutputFormat, humanRenderer: () => string, jsonValue: T): void {
  if (format === 'json') {
    process.stdout.write(JSON.stringify(jsonValue) + '\n');
    return;
  }

  process.stdout.write(`${humanRenderer()}\n`);
}

export function fail(
  format: OutputFormat,
  exitCode: ExitCode,
  message: string,
  details?: FailureDetails,
): never {
  if (format === 'json') {
    process.stderr.write(JSON.stringify({ error: message, details: details ?? null }) + '\n');
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(exitCode);
}

export function emitNotImplemented(command: string, opts: { format?: string }): never {
  const format = resolveFormat(opts.format);
  if (format === 'json') {
    process.stdout.write(
      JSON.stringify({
        error: 'not_implemented',
        command,
        message: 'not yet implemented in M0',
      }) + '\n',
    );
  } else {
    process.stderr.write(`${command}: not yet implemented in M0\n`);
  }
  process.exit(69);
}
