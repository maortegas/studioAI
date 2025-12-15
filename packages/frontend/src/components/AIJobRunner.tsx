import { useState } from 'react';
import { aiJobsApi } from '../api/aiJobs';
import { AIProvider, AIMode } from '@devflow-studio/shared';
import { useSSE } from '../hooks/useSSE';

interface AIJobRunnerProps {
  projectId: string;
  taskId?: string;
}

export default function AIJobRunner({ projectId, taskId }: AIJobRunnerProps) {
  const [provider, setProvider] = useState<AIProvider>('cursor');
  const [mode, setMode] = useState<AIMode>('plan');
  const [prompt, setPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string[]>([]);

  const { events } = useSSE();

  const handleExecute = async () => {
    setRunning(true);
    setOutput([]);

    try {
      const job = await aiJobsApi.execute({
        project_id: projectId,
        task_id: taskId,
        provider,
        mode,
        prompt: prompt || undefined,
      });

      // Listen for events related to this job
      const jobEvents = events.filter((e) => e.data?.jobId === job.id);
      if (jobEvents.length > 0) {
        jobEvents.forEach((event) => {
          if (event.data?.output) {
            setOutput((prev) => [...prev, event.data.output]);
          }
        });
      }
    } catch (error) {
      console.error('Failed to execute AI job:', error);
      alert('Failed to execute AI job');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-xl font-semibold">Execute AI Job</h2>
      </div>
      <div className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Provider
          </label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as AIProvider)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="cursor">Cursor</option>
            <option value="claude">Claude</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Mode
          </label>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as AIMode)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="plan">Plan</option>
            <option value="patch">Patch</option>
            <option value="review">Review</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Additional Prompt (optional)
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
            placeholder="Additional instructions for the AI..."
          />
        </div>

        <button
          onClick={handleExecute}
          disabled={running}
          className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
        >
          {running ? 'Running...' : 'Execute'}
        </button>

        {output.length > 0 && (
          <div className="mt-4">
            <h3 className="font-semibold mb-2">Output:</h3>
            <div className="bg-gray-50 p-4 rounded-lg font-mono text-sm max-h-96 overflow-y-auto">
              {output.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

