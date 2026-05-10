export function emitNotImplemented(command: string, opts: { format?: string }): never {
  const format = opts.format ?? process.env['ADMIN_FORMAT'] ?? 'human';
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
