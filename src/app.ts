import { Hono } from 'hono';
import { cors } from 'hono/cors';

import healthRoute from './routes/health';
import authRoute from './routes/auth';
import apiKeysRoute from './routes/api-keys';
import usageRoute from './routes/usage';
import resumeRoute from './routes/resumes';
import parseRoute from './routes/parse';
import { usageTracker } from './middleware/usage-tracker';
import type { AppEnv } from './types/auth';

const app = new Hono<AppEnv>();

app.use('*', cors());
app.use('*', usageTracker);

app.route('/health', healthRoute);

// Auth routes
app.route('/v1/auth', authRoute);
app.route('/auth', authRoute);

// API Key routes
app.route('/v1/api-keys', apiKeysRoute);
app.route('/api-keys', apiKeysRoute);

// Usage routes
app.route('/v1/usage', usageRoute);
app.route('/usage', usageRoute);

// Resume upload & parse routes
app.route('/v1/resumes', resumeRoute);
app.route('/v1/resumes', parseRoute);
app.route('/', resumeRoute);
app.route('/', parseRoute);

// Root redirect to dashboard
app.get('/', (c) => c.redirect('/dashboard.html'));

export default app;