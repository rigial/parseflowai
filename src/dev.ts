import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import app from './app';

// Serve static test UI pages for local development
app.use('/*', serveStatic({ root: './public' }));

const port = Number(process.env.PORT ?? 3000);

console.log(`Server running on http://localhost:${port}`);
console.log(`- Dashboard:   http://localhost:${port}/dashboard.html`);
console.log(`- Auth Page:   http://localhost:${port}/auth.html`);
console.log(`- Upload Page: http://localhost:${port}/index.html`);
console.log(`- Parse Page:  http://localhost:${port}/parse.html`);

serve({
  fetch: app.fetch,
  port,
});
