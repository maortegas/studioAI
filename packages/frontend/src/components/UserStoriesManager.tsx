import { useState, useEffect } from 'react';
import { tasksApi } from '../api/tasks';
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
  const [editingStory, setEditingStory] = useState<Task | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [storiesCount, setStoriesCount] = useState(10);
  const { showToast } = useToast();

  useEffect(() => {
    loadStories();
  }, [projectId]);

  // Listen for AI job completion
  useEffect(() => {
    if (currentJobId && generating) {
      const checkJobStatus = async () => {
        try {
          const job = await aiJobsApi.getById(currentJobId);
          
          if (job.status === 'completed') {
            try {
              const result = await aiJobsApi.getResult(currentJobId);
              await processGeneratedStories(result.output);
              setGenerating(false);
              setCurrentJobId(null);
              showToast('User stories generated! Review and save them.', 'success');
            } catch (error) {
              console.error('Failed to get job result:', error);
              setGenerating(false);
              setCurrentJobId(null);
            }
          } else if (job.status === 'failed') {
            setGenerating(false);
            setCurrentJobId(null);
            showToast('User stories generation failed', 'error');
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
    try {
      const result = await tasksApi.generateStories(projectId, storiesCount);
      setCurrentJobId(result.job_id);
      showToast('User stories generation started. This may take a few minutes...', 'info');
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to generate user stories', 'error');
      setGenerating(false);
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
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
            >
              {showCreateForm ? 'Cancel' : 'Create Manually'}
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-4 py-2 text-sm bg-purple-600 dark:bg-purple-500 text-white rounded-lg hover:bg-purple-700 dark:hover:bg-purple-600 transition disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate with AI'}
            </button>
          </div>
        </div>

        {/* Generate Form */}
        {!showCreateForm && (
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

