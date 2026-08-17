import { Hono } from 'hono';
import { cors } from 'hono/cors';

import healthRoute from './routes/health';
import resumeRoute from './routes/resumes';
import parseRoute from './routes/parse';

const app = new Hono();

app.use('*', cors());

app.route('/health', healthRoute);
app.route('/v1/resumes', resumeRoute);
app.route('/v1/resumes', parseRoute);
app.route('/', resumeRoute);

export default app;