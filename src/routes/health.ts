import { Hono } from 'hono';

const health = new Hono();

health.get('/', (c) => {
  return c.json({
    success: true,
    service: 'resume-parser-api',
    status: 'healthy',
  });
});

export default health;