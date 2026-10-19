import { serve } from '@hono/node-server';
import { createSelfHostApp } from './selfhost';

const app = createSelfHostApp();
const port = Number(process.env.PORT) || 8321;
const server = serve({ fetch: app.fetch, port });
console.log(`Self-hosted veedeeoh is running on http://localhost:${port}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
