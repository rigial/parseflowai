import { Hono } from 'hono';

const parse = new Hono();

parse.post('/parse', async (c) => {
  const body = await c.req.json();

  return c.json({
    success: true,
    message: 'Resume parsing endpoint',
    data: body,
  });
});

export default parse;