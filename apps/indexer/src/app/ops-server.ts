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
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    this.server.listen(port, () => {
      this.logger.log(`[indexer] ops server listening on :${port}`);
    });
  }

  onApplicationShutdown() {
    if (!this.server) return;
    this.server.close();
    setTimeout(() => this.server?.closeAllConnections?.(), 2000).unref();
  }
}
