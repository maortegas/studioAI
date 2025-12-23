import { useState, useEffect } from 'react';
import { designApi } from '../api/design';
import { aiJobsApi } from '../api/aiJobs';
import { UserFlow } from '@devflow-studio/shared';
import { useToast } from '../context/ToastContext';
import UserFlowViewer from './UserFlowViewer';
import LoadingSpinner from './LoadingSpinner';

interface UserFlowsManagerProps {
  projectId: string;
}

export default function UserFlowsManager({ projectId }: UserFlowsManagerProps) {
  const [flows, setFlows] = useState<UserFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [selectedFlow, setSelectedFlow] = useState<UserFlow | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const { showToast } = useToast();

  // Form state
  const [flowName, setFlowName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    loadFlows();
  }, [projectId]);

  // Poll for job completion
  useEffect(() => {
    if (currentJobId && generating) {
      const checkJobStatus = async () => {
        try {
          const job = await aiJobsApi.getById(currentJobId);
          
          if (job.status === 'completed') {
            setGenerating(false);
            setCurrentJobId(null);
            setShowGenerateForm(false);
            setFlowName('');
            setDescription('');
            showToast('User flow generated successfully!', 'success');
            await loadFlows();
          } else if (job.status === 'failed') {
            setGenerating(false);
            setCurrentJobId(null);
            showToast('User flow generation failed', 'error');
          } else {
            setTimeout(checkJobStatus, 2000);
          }
        } catch (error) {
          console.error('Failed to check job status:', error);
          setTimeout(checkJobStatus, 2000);
        }
      };
      
      checkJobStatus();
    }
  }, [currentJobId, generating, showToast]);

  const loadFlows = async () => {
    try {
      setLoading(true);
      const data = await designApi.getUserFlowsByProject(projectId);
      setFlows(data);
    } catch (error) {
      console.error('Failed to load user flows:', error);
      showToast('Failed to load user flows', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flowName.trim()) {
      showToast('Flow name is required', 'error');
      return;
    }

    setGenerating(true);
    try {
      const result = await designApi.generateUserFlow({
        project_id: projectId,
        flow_name: flowName,
        description: description || undefined,
      });
      setCurrentJobId(result.job_id);
      showToast('User flow generation started. This may take a few minutes...', 'info');
    } catch (error: any) {
      console.error('Failed to generate user flow:', error);
      showToast(error.response?.data?.error || 'Failed to generate user flow', 'error');
      setGenerating(false);
    }
  };

  if (selectedFlow) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelectedFlow(null)}
          className="mb-4 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600"
        >
          ← Back to Flows
        </button>
        <UserFlowViewer flow={selectedFlow} />
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">User Flows</h2>
        <button
          onClick={() => setShowGenerateForm(!showGenerateForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {showGenerateForm ? 'Cancel' : '+ Generate User Flow'}
        </button>
      </div>

      {showGenerateForm && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-700/50">
          <h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Generate User Flow</h3>
          <form onSubmit={handleGenerate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Flow Name *
              </label>
              <input
                type="text"
                value={flowName}
                onChange={(e) => setFlowName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="e.g., Login Flow, Checkout Flow"
                disabled={generating}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="Optional description of the user flow"
                rows={3}
                disabled={generating}
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={generating || !flowName.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {generating ? 'Generating...' : 'Generate'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowGenerateForm(false);
                  setFlowName('');
                  setDescription('');
                }}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                disabled={generating}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {flows.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow dark:shadow-gray-700/50 text-center">
          <p className="text-gray-600 dark:text-gray-400">
            No user flows yet. Generate one to get started!
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {flows.map((flow) => (
            <div
              key={flow.id}
              className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-700/50 hover:shadow-lg dark:hover:shadow-gray-600/50 transition-shadow cursor-pointer"
              onClick={() => setSelectedFlow(flow)}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                    {flow.flow_name}
                  </h3>
                  {flow.description && (
                    <p className="text-gray-600 dark:text-gray-400 mb-2">{flow.description}</p>
                  )}
                  <p className="text-sm text-gray-500 dark:text-gray-500">
                    Created: {new Date(flow.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="ml-4">
                  {flow.flow_diagram ? (
                    <span className="inline-block px-3 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-full text-sm">
                      Diagram Ready
                    </span>
                  ) : (
                    <span className="inline-block px-3 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded-full text-sm">
                      Generating...
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
