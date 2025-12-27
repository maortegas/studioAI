import { useState, useEffect } from 'react';
import { breakdownApi } from '../api/breakdown';
import { rfcApi } from '../api/rfc';
import { tasksApi } from '../api/tasks';
import { Epic, RFCDocument, Task } from '@devflow-studio/shared';
import { useToast } from '../context/ToastContext';

interface BreakdownManagerProps {
  projectId: string;
}

export default function BreakdownManager({ projectId }: BreakdownManagerProps) {
  const [epics, setEpics] = useState<Epic[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [rfcs, setRfcs] = useState<RFCDocument[]>([]);
  const [selectedRfc, setSelectedRfc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadData();
    
    // Poll for task updates every 5 seconds to reflect status changes from implementation
    const interval = setInterval(() => {
      if (selectedRfc) {
        loadEpicsAndTasks();
      } else {
        loadData();
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [projectId, selectedRfc]);

  useEffect(() => {
    if (selectedRfc) {
      loadEpicsAndTasks();
    }
  }, [selectedRfc, projectId]);

  // Listen for AI job completion
  useEffect(() => {
    if (currentJobId && generating) {
      const checkJobStatus = async () => {
        try {
          const { aiJobsApi } = await import('../api/aiJobs');
          const job = await aiJobsApi.getById(currentJobId);
          
          if (job.status === 'completed') {
            setGenerating(false);
            setCurrentJobId(null);
            showToast('Breakdown generated successfully!', 'success');
            await loadEpicsAndTasks();
          } else if (job.status === 'failed') {
            setGenerating(false);
            setCurrentJobId(null);
            showToast('Breakdown generation failed', 'error');
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

  const loadData = async () => {
    try {
      // Load RFCs
      const rfcData = await rfcApi.getByProject(projectId);
      setRfcs(rfcData);
      if (rfcData.length > 0 && !selectedRfc) {
        setSelectedRfc(rfcData[0].id);
      }
      
      // Load all epics for the project
      const epicData = await breakdownApi.getEpicsByProject(projectId);
      setEpics(epicData);
      
      // Load all tasks
      const taskData = await tasksApi.getByProject(projectId);
      setTasks(taskData);
    } catch (error) {
      console.error('Failed to load breakdown data:', error);
      showToast('Failed to load breakdown data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadEpicsAndTasks = async () => {
    if (!selectedRfc) return;
    
    try {
      const epicData = await breakdownApi.getEpicsByRFC(selectedRfc);
      setEpics(epicData);
      
      const taskData = await tasksApi.getByProject(projectId);
      setTasks(taskData);
    } catch (error) {
      console.error('Failed to load epics and tasks:', error);
    }
  };

  const handleGenerate = async () => {
    if (!selectedRfc) {
      showToast('Please select an RFC first', 'error');
      return;
    }

    // Check if RFC is approved
    const rfc = rfcs.find(r => r.id === selectedRfc);
    if (rfc && rfc.status !== 'approved') {
      // Ask user if they want to approve the RFC first
      const shouldApprove = window.confirm(
        `The RFC "${rfc.title}" is not approved (current status: ${rfc.status}).\n\n` +
        `RFCs must be approved before generating breakdown.\n\n` +
        `Would you like to approve it now and then generate the breakdown?`
      );
      
      if (shouldApprove) {
        try {
          await rfcApi.approve(selectedRfc);
          showToast('RFC approved successfully', 'success');
          // Reload RFCs to get updated status
          await loadData();
        } catch (error: any) {
          showToast(error.response?.data?.error || 'Failed to approve RFC', 'error');
          return;
        }
      } else {
        showToast('Please approve the RFC first before generating breakdown', 'warning');
        return;
      }
    }

    setGenerating(true);
    try {
      const result = await breakdownApi.generate({
        project_id: projectId,
        rfc_id: selectedRfc,
      });
      setCurrentJobId(result.job_id);
      showToast('Breakdown generation started. This may take a few minutes...', 'info');
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || 'Failed to generate breakdown';
      showToast(errorMessage, 'error');
      
      // If error mentions RFC not approved, offer to approve
      if (errorMessage.includes('must be approved') || errorMessage.includes('approve')) {
        const rfc = rfcs.find(r => r.id === selectedRfc);
        if (rfc && rfc.status !== 'approved') {
          const shouldApprove = window.confirm(
            `The RFC is not approved. Would you like to approve it now?`
          );
          if (shouldApprove) {
            try {
              await rfcApi.approve(selectedRfc);
              showToast('RFC approved. You can now generate the breakdown.', 'success');
              await loadData();
            } catch (approveError: any) {
              showToast(approveError.response?.data?.error || 'Failed to approve RFC', 'error');
            }
          }
        }
      }
      
      setGenerating(false);
      setCurrentJobId(null);
    }
  };

  const getTasksForEpic = (epicId: string): Task[] => {
    return tasks.filter(task => task.epic_id === epicId);
  };

  const getTotalStoryPoints = (epicId: string): number => {
    return getTasksForEpic(epicId).reduce((sum, task) => sum + (task.story_points || 0), 0);
  };

  const getTotalEstimatedDays = (epicId: string): number => {
    return getTasksForEpic(epicId).reduce((sum, task) => sum + (task.estimated_days || 0), 0);
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-900 dark:text-white">Loading breakdown...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50">
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Breakdown & Estimación</h2>
          <div className="flex space-x-4 items-center">
            {rfcs.length > 0 && (
              <select
                value={selectedRfc || ''}
                onChange={(e) => setSelectedRfc(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                {rfcs.map((rfc) => (
                  <option key={rfc.id} value={rfc.id}>
                    {rfc.title} {rfc.status !== 'approved' ? `(${rfc.status})` : ''}
                  </option>
                ))}
              </select>
            )}
            {selectedRfc && (() => {
              const selectedRfcDoc = rfcs.find(r => r.id === selectedRfc);
              const isApproved = selectedRfcDoc?.status === 'approved';
              
              return (
                <>
                  {!isApproved && (
                    <button
                      onClick={async () => {
                        try {
                          await rfcApi.approve(selectedRfc);
                          showToast('RFC approved successfully', 'success');
                          await loadData();
                        } catch (error: any) {
                          showToast(error.response?.data?.error || 'Failed to approve RFC', 'error');
                        }
                      }}
                      className="px-4 py-2 text-sm bg-yellow-600 dark:bg-yellow-500 text-white rounded-lg hover:bg-yellow-700 dark:hover:bg-yellow-600 transition"
                      title={`RFC status: ${selectedRfcDoc?.status}. Click to approve.`}
                    >
                      Approve RFC
                    </button>
                  )}
                  <button
                    onClick={handleGenerate}
                    disabled={generating || !selectedRfc || !isApproved}
                    className="px-4 py-2 text-sm bg-purple-600 dark:bg-purple-500 text-white rounded-lg hover:bg-purple-700 dark:hover:bg-purple-600 transition disabled:opacity-50"
                    title={!isApproved ? 'Please approve the RFC first' : 'Generate breakdown from RFC'}
                  >
                    {generating ? 'Generating...' : 'Generate Breakdown'}
                  </button>
                </>
              );
            })()}
          </div>
        </div>

        <div className="p-6">
          {rfcs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-600 dark:text-gray-400 mb-4">No RFC documents found.</p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                Please create an RFC first to generate breakdown and estimations.
              </p>
            </div>
          ) : epics.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-600 dark:text-gray-400 mb-4">No breakdown generated yet.</p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                Generate a breakdown from your RFC to create epics and tasks with estimations.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {epics.map((epic) => {
                const epicTasks = getTasksForEpic(epic.id);
                const totalStoryPoints = getTotalStoryPoints(epic.id);
                const totalEstimatedDays = getTotalEstimatedDays(epic.id);
                
                return (
                  <div
                    key={epic.id}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg p-6"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                          {epic.title}
                        </h3>
                        {epic.description && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {epic.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center space-x-4 text-sm">
                        {epic.story_points && (
                          <span className="text-gray-600 dark:text-gray-400">
                            Story Points: <strong>{epic.story_points}</strong>
                          </span>
                        )}
                        <span className={`px-2 py-1 text-xs rounded ${
                          epic.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                          epic.status === 'in_progress' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                          'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                          {epic.status}
                        </span>
                      </div>
                    </div>

                    {epicTasks.length > 0 && (
                      <div className="mt-4">
                        <div className="mb-3 text-sm text-gray-600 dark:text-gray-400">
                          <strong>{epicTasks.length}</strong> tasks | 
                          Total Story Points: <strong>{totalStoryPoints}</strong> | 
                          Total Estimated Days: <strong>{totalEstimatedDays}</strong>
                        </div>
                        <div className="space-y-2">
                          {epicTasks
                            .sort((a, b) => (a.breakdown_order || 0) - (b.breakdown_order || 0))
                            .map((task) => (
                            <div
                              key={task.id}
                              className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600"
                            >
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <h4 className="font-medium text-gray-900 dark:text-white">
                                    {task.breakdown_order && `${task.breakdown_order}. `}
                                    {task.title}
                                  </h4>
                                  {task.description && (
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                      {task.description}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center space-x-3 ml-4 text-sm">
                                  {task.story_points && (
                                    <span className="text-gray-600 dark:text-gray-400">
                                      SP: <strong>{task.story_points}</strong>
                                    </span>
                                  )}
                                  {task.estimated_days && (
                                    <span className="text-gray-600 dark:text-gray-400">
                                      Days: <strong>{task.estimated_days}</strong>
                                    </span>
                                  )}
                                  <span className={`px-2 py-1 text-xs rounded ${
                                    task.status === 'done' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                                    task.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                                    task.status === 'in_progress' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                                    'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                                  }`}>
                                    {task.status === 'done' ? 'done' : task.status}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
