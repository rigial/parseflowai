import { Hono } from 'hono';

const resumes = new Hono();

resumes.post('/upload-url', async (c) => {
  return c.json({
    success: true,
    message: 'Upload URL endpoint',
  });
});

export default resumes;