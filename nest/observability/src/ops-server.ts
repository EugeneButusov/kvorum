import * as http from 'node:http';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { renderMetrics } from '@libs/observability';

@Injectable()
export class OpsServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OpsServer.name);
  private server?: http.Server;

  onApplicationBootstrap() {
    const port = Number(process.env['OPS_PORT'] ?? 9091);
    this.server = http.createServer(async (req, res) => {
      if (req.url === '/metrics') {
        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.end(await renderMetrics());
      } else if (req.url === '/health') {
        // Readiness/liveness probe target for workers that expose no app HTTP port
        // (e.g. apps/indexer runs as a standalone Nest context). The API has its own
        // /health on the app port; this covers every OpsServer-hosting process.
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    this.server.listen(port, () => {
      this.logger.log(`ops server listening on :${port}`);
    });
  }

  onApplicationShutdown() {
    if (!this.server) return;
    this.server.close();
    setTimeout(() => this.server?.closeAllConnections?.(), 2000).unref();
  }
}
