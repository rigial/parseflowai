import { Hono } from 'hono';

import healthRoute from './routes/health';
import resumeRoute from './routes/resumes';
import parseRoute from './routes/parse';

const app = new Hono();

app.route('/health', healthRoute);
app.route('/v1/resumes', resumeRoute);
app.route('/v1/resumes', parseRoute);

export default app;