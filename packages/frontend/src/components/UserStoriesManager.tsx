import { useState, useEffect } from 'react';
import { tasksApi } from '../api/tasks';
import { userStoriesApi } from '../api/userStories';
import { prdApi } from '../api/prd';
import { Task } from '@devflow-studio/shared';
import { useToast } from '../context/ToastContext';
import CreateUserStoryForm from './CreateUserStoryForm';
import { aiJobsApi } from '../api/aiJobs';

interface UserStoriesManagerProps {
  projectId: string;
}

export default function UserStoriesManager({ projectId }: UserStoriesManagerProps) {
  const [stories, setStories] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showImproveForm, setShowImproveForm] = useState(false);
  const [editingStory, setEditingStory] = useState<Task | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [storiesCount, setStoriesCount] = useState(10);
  const [hasPRD, setHasPRD] = useState<boolean | null>(null); // null = not checked yet
  const [idea, setIdea] = useState('');
  const [isImproving, setIsImproving] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    loadStories();
    checkPRD();
    
    // Listen for artifact updates to refresh PRD status
    const handleArtifactUpdate = (event: CustomEvent) => {
      if (event.detail.projectId === projectId) {
        checkPRD(); // Re-check PRD when artifacts are updated
      }
    };
    
    window.addEventListener('artifactUpdated' as any, handleArtifactUpdate);
    
    return () => {
      window.removeEventListener('artifactUpdated' as any, handleArtifactUpdate);
    };
  }, [projectId]);

  const checkPRD = async () => {
    try {
      // Check new PRD system first
      const prd = await prdApi.getByProject(projectId);
      if (prd) {
        setHasPRD(true);
        return;
      }
    } catch (error: any) {
      // 404 is expected when no PRD exists in new system - continue checking old system
      if (error.response?.status !== 404) {
        console.error('Error checking PRD (new system):', error);
      }
    }
    
    // Fallback: Check old PRD system (artifacts)
    try {
      const { artifactsApi } = await import('../api/artifacts');
      const artifacts = await artifactsApi.getByProject(projectId);
      const prdArtifact = artifacts.find((a) => a.type === 'prd');
      setHasPRD(!!prdArtifact);
    } catch (error: any) {
      console.error('Error checking PRD (old system):', error);
      setHasPRD(false);
    }
  };

  // Listen for AI job completion
  useEffect(() => {
    if (currentJobId && (generating || isImproving)) {
      const checkJobStatus = async () => {
        try {
          const job = await aiJobsApi.getById(currentJobId);
          
          if (job.status === 'completed') {
            try {
              if (isImproving) {
                const result = await aiJobsApi.getResult(currentJobId);
                await processImprovedStory(result.output);
                setGenerating(false);
                setIsImproving(false);
                setCurrentJobId(null);
                showToast('Story improved! Review and save it.', 'success');
              } else {
                // Check if this was a story_generation job (new flow) or old flow
                const phase = job.args?.phase;
                if (phase === 'story_generation') {
                  // For new flow, stories are saved automatically by worker
                  // Wait a moment for database to be fully updated, then reload
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  
                  // Reload stories from API
                  try {
                    const data = await tasksApi.getByProjectAndType(projectId, 'story');
                    setStories(data);
                    setGenerating(false);
                    setCurrentJobId(null);
                    showToast(`User stories generated successfully! (${data.length} stories)`, 'success');
                  } catch (reloadError) {
                    console.error('Failed to reload stories:', reloadError);
                    setGenerating(false);
                    setCurrentJobId(null);
                    showToast('Stories generated, but failed to reload. Please refresh the page.', 'warning');
                  }
                } else {
                  // Old flow - parse and show for review
                  const result = await aiJobsApi.getResult(currentJobId);
                  await processGeneratedStories(result.output);
                  setGenerating(false);
                  setCurrentJobId(null);
                  showToast('User stories generated! Review and save them.', 'success');
                }
              }
            } catch (error) {
              console.error('Failed to get job result:', error);
              setGenerating(false);
              setIsImproving(false);
              setCurrentJobId(null);
            }
          } else if (job.status === 'failed') {
            setGenerating(false);
            setIsImproving(false);
            setCurrentJobId(null);
            if (isImproving) {
              showToast('Story improvement failed', 'error');
            } else {
            showToast('User stories generation failed', 'error');
            }
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
  }, [currentJobId, generating, isImproving, projectId, showToast]);

  const loadStories = async () => {
    try {
      const data = await tasksApi.getByProjectAndType(projectId, 'story');
      setStories(data);
    } catch (error) {
      console.error('Failed to load user stories:', error);
      showToast('Failed to load user stories', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Note: processGeneratedStories is no longer needed for new flow
  // Stories are saved automatically by the worker
  // This function is kept for backward compatibility with old flow
  const processGeneratedStories = async (output: string) => {
    try {
      // Try to parse JSON array from output
      let storiesData: any[] = [];
      
      // Extract JSON from output (might have extra text)
      const jsonMatch = output.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        storiesData = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: try to parse entire output
        storiesData = JSON.parse(output);
      }

      // Store generated stories temporarily for review
      setGeneratedStoriesForReview(storiesData);
    } catch (error) {
      console.error('Failed to parse generated stories:', error);
      showToast('Failed to parse generated stories. Please check the output format.', 'error');
    }
  };

  const processImprovedStory = async (output: string) => {
    try {
      // Try to parse JSON object from output (single story, not array)
      let storyData: any;
      
      // Extract JSON from output (might have extra text)
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        storyData = JSON.parse(jsonMatch[0]);
      } else {
        // Fallback: try to parse entire output
        storyData = JSON.parse(output);
      }

      // If it's an array with one element, extract it
      if (Array.isArray(storyData) && storyData.length > 0) {
        storyData = storyData[0];
      }

      // Store improved story temporarily for review
      setGeneratedStoriesForReview([storyData]);
      setShowImproveForm(false);
      setIdea('');
    } catch (error) {
      console.error('Failed to parse improved story:', error);
      showToast('Failed to parse improved story. Please check the output format.', 'error');
    }
  };

  const [generatedStoriesForReview, setGeneratedStoriesForReview] = useState<any[]>([]);

  const handleSaveGeneratedStory = async (storyData: any) => {
    try {
      // Parse acceptance criteria
      const acceptanceCriteria = Array.isArray(storyData.acceptance_criteria)
        ? storyData.acceptance_criteria
        : typeof storyData.acceptance_criteria === 'string'
        ? storyData.acceptance_criteria.split('\n').filter((s: string) => s.trim())
        : [];

      // Build description with acceptance criteria
      let description = storyData.description || '';
      if (acceptanceCriteria.length > 0) {
        description += '\n\n**Acceptance Criteria:**\n' + acceptanceCriteria.map((ac: string) => `- ${ac}`).join('\n');
      }

      await tasksApi.create({
        project_id: projectId,
        title: storyData.title,
        description,
        type: 'story',
        priority: storyData.priority || 5,
      });

      // Remove from review list
      setGeneratedStoriesForReview(prev => prev.filter(s => s.title !== storyData.title));
      await loadStories();
      showToast('User story saved!', 'success');
      window.dispatchEvent(new CustomEvent('artifactUpdated', { detail: { projectId } }));
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to save user story', 'error');
    }
  };

  const handleSaveAllGeneratedStories = async () => {
    for (const storyData of generatedStoriesForReview) {
      await handleSaveGeneratedStory(storyData);
    }
    setGeneratedStoriesForReview([]);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setIsImproving(false);
    try {
      // Check if we already know there's a PRD (to avoid unnecessary API call)
      if (hasPRD === true) {
        // We already know there's a PRD, use new endpoint directly
        const prd = await prdApi.getByProject(projectId);
        if (!prd) {
          // PRD was deleted, update state
          setHasPRD(false);
          showToast('PRD not found. Please create a PRD first.', 'error');
          setGenerating(false);
          return;
        }

        // Use new API endpoint for generating stories from PRD
        const result = await userStoriesApi.generate({
          project_id: projectId,
          prd_id: prd.id,
        });
        if (result.job_id) {
          setCurrentJobId(result.job_id);
          showToast('Generating all user stories from PRD. This may take a few minutes...', 'info');
        } else {
          showToast('Generation started but job ID not returned', 'warning');
        }
        return;
      }

      // Check PRD status first
      const prd = await prdApi.getByProject(projectId);
      
      if (!prd) {
        // No PRD found - check old system as fallback
        try {
          const { artifactsApi } = await import('../api/artifacts');
          const artifacts = await artifactsApi.getByProject(projectId);
          const prdArtifact = artifacts.find((a) => a.type === 'prd');
          
          if (!prdArtifact) {
            // No PRD in either system - use old endpoint with count
            setHasPRD(false);
            const result = await tasksApi.generateStories(projectId, storiesCount);
            setCurrentJobId(result.job_id);
            showToast(`Generating ${storiesCount} user stories... This may take a few minutes...`, 'info');
            return;
          } else {
            // PRD exists in old system, but we can't use it for new flow
            // Show error message
            setHasPRD(false);
            showToast('Please use the new PRD system in the "Prd" tab to generate stories automatically.', 'warning');
            setGenerating(false);
            return;
          }
        } catch (error: any) {
          setHasPRD(false);
          const result = await tasksApi.generateStories(projectId, storiesCount);
          setCurrentJobId(result.job_id);
          showToast(`Generating ${storiesCount} user stories... This may take a few minutes...`, 'info');
          return;
        }
      }

      // PRD found - use new endpoint
      setHasPRD(true);
      const result = await userStoriesApi.generate({
        project_id: projectId,
        prd_id: prd.id,
      });
      if (result.job_id) {
        setCurrentJobId(result.job_id);
        showToast('Generating all user stories from PRD. This may take a few minutes...', 'info');
      } else {
        showToast('Generation started but job ID not returned', 'warning');
      }
    } catch (error: any) {
      console.error('Error generating stories:', error);
      showToast(error.response?.data?.error || 'Failed to generate user stories', 'error');
      setGenerating(false);
      setCurrentJobId(null);
    }
  };

  const handleImproveStory = async () => {
    if (!idea.trim()) {
      showToast('Please enter an idea for the story', 'error');
      return;
    }

    setIsImproving(true);
    setGenerating(false);
    try {
      const result = await tasksApi.improveStory(projectId, idea);
      setCurrentJobId(result.job_id);
      showToast('Improving your story idea...', 'info');
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to improve story', 'error');
      setIsImproving(false);
      setCurrentJobId(null);
    }
  };

  const handleDelete = async (storyId: string) => {
    if (!confirm('Are you sure you want to delete this user story?')) {
      return;
    }

    try {
      await tasksApi.delete(storyId);
      await loadStories();
      showToast('User story deleted', 'success');
      window.dispatchEvent(new CustomEvent('artifactUpdated', { detail: { projectId } }));
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to delete user story', 'error');
    }
  };

  const handleUpdateStatus = async (storyId: string, newStatus: Task['status']) => {
    try {
      await tasksApi.update(storyId, { status: newStatus });
      await loadStories();
      showToast('User story updated', 'success');
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to update user story', 'error');
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-900 dark:text-white">Loading user stories...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header with Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50">
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">User Stories</h2>
          <div className="flex space-x-2">
            <button
              onClick={() => {
                setShowCreateForm(!showCreateForm);
                setShowImproveForm(false);
              }}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
            >
              {showCreateForm ? 'Cancel' : 'Create Manually'}
            </button>
            <button
              onClick={() => {
                setShowImproveForm(!showImproveForm);
                setShowCreateForm(false);
              }}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
            >
              {showImproveForm ? 'Cancel' : 'Improve Idea with AI'}
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating || isImproving}
              className="px-4 py-2 text-sm bg-purple-600 dark:bg-purple-500 text-white rounded-lg hover:bg-purple-700 dark:hover:bg-purple-600 transition disabled:opacity-50"
            >
              {generating
                ? 'Generating...'
                : hasPRD === true
                  ? 'Generate All Stories from PRD'
                  : 'Generate Multiple with AI'}
            </button>
          </div>
        </div>

        {/* Improve Idea Form */}
        {showImproveForm && (
          <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Enter your story idea:
                </label>
                <textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder="Example: I want users to be able to login with their email and password..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 h-24"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  💡 Describe your idea simply. AI will improve it and format it as a professional user story.
                </p>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={handleImproveStory}
                  disabled={!idea.trim() || isImproving || generating}
                  className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition disabled:opacity-50"
                >
                  {isImproving ? 'Improving...' : 'Improve with AI'}
                </button>
                <button
                  onClick={() => {
                    setShowImproveForm(false);
                    setIdea('');
                  }}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Generate Form - Only show count input if no PRD (legacy mode) */}
        {/* Only show when hasPRD is explicitly false (not null, which means still checking) */}
        {!showCreateForm && !showImproveForm && hasPRD === false && (
          <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
            <div className="flex items-center space-x-4">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Number of stories to generate:
              </label>
              <input
                type="number"
                min="1"
                max="50"
                value={storiesCount}
                onChange={(e) => setStoriesCount(parseInt(e.target.value) || 10)}
                className="w-20 px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500 dark:focus:ring-purple-400"
              />
            </div>
          </div>
        )}

        {/* Info message when PRD exists */}
        {/* Only show when hasPRD is explicitly true */}
        {!showCreateForm && !showImproveForm && hasPRD === true && (
          <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              <strong>✨ New Flow:</strong> Click "Generate All Stories from PRD" to automatically generate all user stories needed to fulfill the PRD requirements. No need to specify a count - the AI will generate all necessary stories based on your PRD.
            </p>
          </div>
        )}

        {/* Create Form */}
        {showCreateForm && (
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <CreateUserStoryForm
              projectId={projectId}
              onSuccess={async () => {
                setShowCreateForm(false);
                await loadStories();
                window.dispatchEvent(new CustomEvent('artifactUpdated', { detail: { projectId } }));
              }}
              onCancel={() => setShowCreateForm(false)}
            />
          </div>
        )}

        {/* Generated Stories for Review */}
        {generatedStoriesForReview.length > 0 && (
          <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-medium text-lg text-gray-900 dark:text-white">
                Review Generated Stories ({generatedStoriesForReview.length})
              </h3>
              <button
                onClick={handleSaveAllGeneratedStories}
                className="px-4 py-2 text-sm bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600"
              >
                Save All
              </button>
            </div>
            <div className="space-y-3">
              {generatedStoriesForReview.map((storyData, index) => (
                <div key={index} className="bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-medium text-gray-900 dark:text-white">{storyData.title}</h4>
                    <button
                      onClick={() => handleSaveGeneratedStory(storyData)}
                      className="px-3 py-1 text-xs bg-blue-600 dark:bg-blue-500 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-600"
                    >
                      Save
                    </button>
                  </div>
                  {storyData.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">{storyData.description}</p>
                  )}
                  {storyData.acceptance_criteria && storyData.acceptance_criteria.length > 0 && (
                    <div className="text-sm text-gray-700 dark:text-gray-300">
                      <strong className="text-gray-900 dark:text-white">Acceptance Criteria:</strong>
                      <ul className="list-disc list-inside ml-2 mt-1">
                        {storyData.acceptance_criteria.map((ac: string, i: number) => (
                          <li key={i}>{ac}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Priority: {storyData.priority || 'N/A'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stories List */}
        <div className="p-6">
          {stories.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400 mb-4">No user stories yet</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
                Generate user stories with AI based on your PRD, or create them manually.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {stories.map((story) => (
                <div
                  key={story.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition bg-white dark:bg-gray-800"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg mb-1 text-gray-900 dark:text-white">{story.title}</h3>
                      {story.description && (
                        <div className="text-sm text-gray-600 dark:text-gray-300 mt-2 whitespace-pre-wrap">
                          {story.description}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 ml-4">
                      <select
                        value={story.status}
                        onChange={(e) => handleUpdateStatus(story.id, e.target.value as Task['status'])}
                        className={`px-2 py-1 text-xs rounded border ${
                          story.status === 'done'
                            ? 'bg-green-100 text-green-800 border-green-300'
                            : story.status === 'in_progress'
                            ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                            : story.status === 'blocked'
                            ? 'bg-red-100 text-red-800 border-red-300'
                            : 'bg-gray-100 text-gray-800 border-gray-300'
                        }`}
                      >
                        <option value="todo">Todo</option>
                        <option value="in_progress">In Progress</option>
                        <option value="blocked">Blocked</option>
                        <option value="done">Done</option>
                      </select>
                      <span className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded">
                        Priority: {story.priority}
                      </span>
                      <button
                        onClick={() => handleDelete(story.id)}
                        className="px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Created: {new Date(story.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

