import { defineCommand } from 'citty';
import consola from 'consola';
import { createApp } from '../server/app.ts';

export default defineCommand({
  meta: { name: 'serve', description: 'Start the murmur TTS server' },
  args: {
    port: {
      type: 'string',
      alias: 'p',
      description: 'Port to listen on',
      default: '8080',
    },
    host: {
      type: 'string',
      alias: 'H',
      description: 'Host to bind to',
      default: '0.0.0.0',
    },
  },
  async run({ args }) {
    const port = Number.parseInt(args.port, 10);
    const host = args.host;
    const app = createApp();

    const server = Bun.serve({
      port,
      hostname: host,
      fetch: app.fetch,
    });

    consola.box(`murmur v0.1.0\nListening on http://${server.hostname}:${server.port}`);
  },
});
