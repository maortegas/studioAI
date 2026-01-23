import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import projectsRouter from './routes/projects';
import tasksRouter from './routes/tasks';
import stagesRouter from './routes/stages';
import databaseRouter from './routes/database';
import prdRouter from './routes/prd';
import userStoriesRouter from './routes/user-stories';
import designRouter from './routes/design';
import rfcRouter from './routes/rfc';
import breakdownRouter from './routes/breakdown';
import codingSessionsRouter from './routes/coding-sessions';
import testSuitesRouter from './routes/test-suites';
import qaRouter from './routes/qa';
import releasesRouter from './routes/releases';
import metricsRouter from './routes/metrics';
import architectureRouter from './routes/architecture';
import aiJobsRouter from './routes/ai-jobs';
import eventsRouter from './routes/events';
import artifactsRouter from './routes/artifacts';
import traceabilityRouter from './routes/traceability';
import reviewRouter from './routes/review';
import roadmapRouter from './routes/roadmap';
import integrationTestPlansRouter from './routes/integration-test-plans';
import { validateProjectPath } from './middleware/validation';
import { auditLog } from './middleware/audit';

const app = express();
const PORT = process.env.PORT || 3001;

console.log('[1] Express app created');

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(auditLog);

console.log('[2] Middleware configured');

// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// Routes
app.use('/api/projects', validateProjectPath, projectsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/stages', stagesRouter);
app.use('/api/database', databaseRouter);
app.use('/api/prd', prdRouter);
app.use('/api/user-stories', userStoriesRouter);
app.use('/api/design', designRouter);
app.use('/api/rfc', rfcRouter);
app.use('/api/breakdown', breakdownRouter);
app.use('/api/coding-sessions', codingSessionsRouter);
app.use('/api/test-suites', testSuitesRouter);
app.use('/api/qa', qaRouter);
app.use('/api/releases', releasesRouter);
app.use('/api/metrics', metricsRouter);
app.use('/api/architecture', architectureRouter);
app.use('/api/ai-jobs', aiJobsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/artifacts', artifactsRouter);
app.use('/api/traceability', traceabilityRouter);
app.use('/api/review', reviewRouter);
app.use('/api/roadmap', roadmapRouter);
app.use('/api/integration-test-plans', integrationTestPlansRouter);

console.log('[3] Routes configured');

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

console.log('[4] Starting server...');

// Start server
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

server.on('error', (err: any) => {
  console.error('❌ Server error:', err);
});

// Error handlers
process.on('unhandledRejection', (error: any) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error: any) => {
  console.error('Uncaught exception:', error);
});
