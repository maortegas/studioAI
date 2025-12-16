import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import projectsRouter from './routes/projects';
import artifactsRouter from './routes/artifacts';
import tasksRouter from './routes/tasks';
import aiJobsRouter from './routes/ai-jobs';
import eventsRouter from './routes/events';
import stagesRouter from './routes/stages';
import roadmapRouter from './routes/roadmap';
import architectureRouter from './routes/architecture';
import codingSessionsRouter from './routes/coding-sessions';
import qaRouter from './routes/qa';
import testSuitesRouter from './routes/test-suites';
import releasesRouter from './routes/releases';
import { validateProjectPath } from './middleware/validation';
import { auditLog } from './middleware/audit';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(auditLog);

// Routes
app.use('/api/projects', validateProjectPath, projectsRouter);
app.use('/api/artifacts', artifactsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/ai-jobs', aiJobsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/stages', stagesRouter);
app.use('/api/roadmap', roadmapRouter);
app.use('/api/architecture', architectureRouter);
app.use('/api/coding-sessions', codingSessionsRouter);
app.use('/api/qa', qaRouter);
app.use('/api/test-suites', testSuitesRouter);
app.use('/api/releases', releasesRouter);

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

