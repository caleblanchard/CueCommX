import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const app = createApp({ config });

  try {
    const httpAddress = await app.listen({
      host: config.host,
      port: config.port,
    });

    console.log(`[CueCommX] HTTP server listening at ${httpAddress}`);

    if (config.tls) {
      const httpsServer = createHttpsServer({
        cert: readFileSync(config.tls.certPath),
        key: readFileSync(config.tls.keyPath),
      });

      httpsServer.on("request", (req, res) => {
        app.routing(req, res);
      });

      app.attachWebSocketServer(httpsServer);

      await new Promise<void>((resolve, reject) => {
        httpsServer.listen(config.httpsPort, config.host, () => resolve());
        httpsServer.on("error", reject);
      });

      console.log(`[CueCommX] HTTPS server listening at https://${config.host}:${config.httpsPort}`);

      const originalClose = app.close.bind(app);

      app.close = (async () => {
        await new Promise<void>((resolve, reject) => {
          httpsServer.close((err) => (err ? reject(err) : resolve()));
        });
        return originalClose();
      }) as typeof app.close;
    }
  } catch (error) {
    console.error("[CueCommX] Fatal startup error:", error);
    process.exit(1);
  }
}

void main();
