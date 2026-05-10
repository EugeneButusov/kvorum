import * as http from 'http';

type ScriptedResponse =
  | { type: 'success'; result: unknown }
  | { type: 'httpError'; status: number }
  | { type: 'rpcError'; code: number; message: string }
  | { type: 'malformedBody' }
  | { type: 'delay'; ms: number; then: ScriptedResponse }
  | { type: 'chainId'; hex: string };

export class FakeProvider {
  private server: http.Server;
  private script: ScriptedResponse | null = null;
  /** FIFO queue — if populated, dequeues one response per request before falling back to script. */
  private queue: ScriptedResponse[] = [];
  private requestCount = 0;
  readonly url: string;

  private constructor(server: http.Server, url: string) {
    this.server = server;
    this.url = url;
  }

  static async create(): Promise<FakeProvider> {
    return new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        const parsed = JSON.parse(body) as { id: number };

        const fake = (server as unknown as { _fake: FakeProvider })._fake;
        fake.requestCount++;

        await fake.handleRequest(parsed.id, res);
      });

      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as { port: number };
        const fake = new FakeProvider(server, `http://127.0.0.1:${port}`);
        (server as unknown as { _fake: FakeProvider })._fake = fake;
        resolve(fake);
      });
    });
  }

  private async handleRequest(id: number, res: http.ServerResponse): Promise<void> {
    const next = this.queue.length > 0 ? this.queue.shift()! : this.script;
    await this.sendScripted(id, res, next);
  }

  private async sendScripted(
    id: number,
    res: http.ServerResponse,
    script: ScriptedResponse | null,
  ): Promise<void> {
    if (!script) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result: null }));
      return;
    }

    if (script.type === 'delay') {
      await new Promise<void>((r) => setTimeout(r, script.ms));
      await this.sendScripted(id, res, script.then);
      return;
    }

    if (script.type === 'success') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result: script.result }));
      return;
    }

    if (script.type === 'httpError') {
      res.writeHead(script.status);
      res.end();
      return;
    }

    if (script.type === 'rpcError') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: script.code, message: script.message },
        }),
      );
      return;
    }

    if (script.type === 'malformedBody') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('this is not json at all }{{{');
      return;
    }

    if (script.type === 'chainId') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result: script.hex }));
      return;
    }
  }

  /** Set the persistent fallback script (used when the queue is empty). */
  returnSuccess(result: unknown): this {
    this.script = { type: 'success', result };
    return this;
  }

  returnError(httpStatus: number): this {
    this.script = { type: 'httpError', status: httpStatus };
    return this;
  }

  returnRpcError(code: number, message: string): this {
    this.script = { type: 'rpcError', code, message };
    return this;
  }

  delay(ms: number, then: ScriptedResponse): this {
    this.script = { type: 'delay', ms, then };
    return this;
  }

  returnMalformedBody(): this {
    this.script = { type: 'malformedBody' };
    return this;
  }

  returnChainId(hex: string): this {
    this.script = { type: 'chainId', hex };
    return this;
  }

  stall(): this {
    this.script = { type: 'delay', ms: 60_000, then: { type: 'success', result: null } };
    return this;
  }

  /** Enqueue a one-shot response that is served before the persistent script. */
  enqueue(response: ScriptedResponse): this {
    this.queue.push(response);
    return this;
  }

  enqueueChainId(hex: string): this {
    return this.enqueue({ type: 'chainId', hex });
  }

  enqueueSuccess(result: unknown): this {
    return this.enqueue({ type: 'success', result });
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  resetRequestCount(): this {
    this.requestCount = 0;
    return this;
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      // closeAllConnections() forcefully terminates keep-alive and stalled connections
      // so stall() tests don't hang on afterEach cleanup.
      this.server.closeAllConnections?.();
      this.server.close(() => resolve());
    });
  }
}
