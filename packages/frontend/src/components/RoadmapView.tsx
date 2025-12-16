import { useEffect, useState } from 'react';
import { roadmapApi } from '../api/roadmap';
import { tasksApi } from '../api/tasks';
import { Task, Roadmap } from '@devflow-studio/shared';
import { useToast } from '../context/ToastContext';
import RoadmapEditor from './RoadmapEditor';
import RoadmapTimeline from './RoadmapTimeline';
import { aiJobsApi } from '../api/aiJobs';

interface RoadmapViewProps {
  projectId: string;
}

export default function RoadmapView({ projectId }: RoadmapViewProps) {
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [milestones, setMilestones] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const { showToast } = useToast();

  useEffect(() => {
    loadRoadmap();
  }, [projectId]);

  // Listen for AI job completion
  useEffect(() => {
    if (currentJobId && generating) {
      const checkJobStatus = async () => {
        try {
          const job = await aiJobsApi.getById(currentJobId);
          
          if (job.status === 'completed') {
            setGenerating(false);
            setCurrentJobId(null);
            showToast('Roadmap generated successfully!', 'success');
            await loadRoadmap();
          } else if (job.status === 'failed') {
            setGenerating(false);
            setCurrentJobId(null);
            showToast('Roadmap generation failed', 'error');
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

  const loadRoadmap = async () => {
    try {
      const data = await roadmapApi.getByProject(projectId);
      // Handle both old format (artifact) and new format (roadmap object)
      if (data.roadmap && data.roadmap.content) {
        setRoadmap(data.roadmap.content as Roadmap);
      } else if (data.roadmap && typeof data.roadmap === 'object' && 'title' in data.roadmap) {
        // Direct roadmap object
        setRoadmap(data.roadmap as Roadmap);
      } else if (data.roadmap === null && data.milestones && data.milestones.length > 0) {
        // If roadmap artifact doesn't exist but milestones do, create a basic roadmap structure
        setRoadmap({
          project_id: projectId,
          title: 'Roadmap',
          milestones: data.milestones.map((m: Task) => ({
            id: m.id,
            title: m.title,
            description: m.description,
            status: m.status as any,
            priority: m.priority,
          })),
        });
      } else {
        setRoadmap(null);
      }
      setMilestones(data.milestones || []);
    } catch (error) {
      console.error('Failed to load roadmap:', error);
      showToast('Failed to load roadmap', 'error');
      setRoadmap(null);
      setMilestones([]);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await roadmapApi.generate(projectId);
      setCurrentJobId(result.job_id);
      showToast('Roadmap generation started. This may take a few minutes...', 'info');
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to generate roadmap', 'error');
      setGenerating(false);
      setCurrentJobId(null);
    }
  };

  const handleCreateSuccess = async () => {
    setShowCreateForm(false);
    await loadRoadmap();
    window.dispatchEvent(new CustomEvent('artifactUpdated', { detail: { projectId } }));
  };

  if (loading) {
    return <div className="text-center py-8">Loading roadmap...</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="border-b border-gray-200 px-6 py-4 flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold">Roadmap</h2>
          {roadmap && (
            <p className="text-sm text-gray-500 mt-1">{roadmap.title}</p>
          )}
        </div>
{!showCreateForm && (
          <div className="flex items-center space-x-2">
            {roadmap && milestones.length > 0 && (
              <div className="flex border border-gray-300 rounded-lg overflow-hidden mr-2">
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-2 text-sm transition ${
                    viewMode === 'list'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  List
                </button>
                <button
                  onClick={() => setViewMode('timeline')}
                  className={`px-3 py-2 text-sm transition ${
                    viewMode === 'timeline'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  Timeline
                </button>
              </div>
            )}
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Create Manually
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate with AI'}
            </button>
          </div>
        )}
      </div>

      <div className="p-6">
        {showCreateForm ? (
          <RoadmapEditor
            projectId={projectId}
            onSuccess={handleCreateSuccess}
            onCancel={() => setShowCreateForm(false)}
          />
) : roadmap && milestones.length > 0 ? (
          <div className="space-y-6">
            {roadmap.description && (
              <div className="text-gray-600 mb-4">{roadmap.description}</div>
            )}
            
            {viewMode === 'timeline' ? (
              <RoadmapTimeline 
                milestones={milestones} 
                roadmapMilestones={roadmap.milestones}
              />
            ) : (
              <div className="space-y-4">
                {milestones
                  .sort((a, b) => b.priority - a.priority)
                  .map((milestone) => {
                    const roadmapMilestone = roadmap.milestones.find(
                      (m) => m.id === milestone.id
                    );
                    
                    return (
                      <div
                        key={milestone.id}
                        className="border border-gray-200 rounded-lg p-5 hover:shadow-md transition"
                      >
                        <div className="flex justify-between items-start mb-3">
                          <div className="flex-1">
                            <h3 className="font-semibold text-lg mb-2">
                              {milestone.title}
                            </h3>
                            {milestone.description && (
                              <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">
                                {milestone.description}
                              </p>
                            )}
                            {roadmapMilestone?.targetDate && (
                              <p className="text-xs text-gray-500 mt-2">
                                Target Date: {new Date(roadmapMilestone.targetDate).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center space-x-2 ml-4">
                            <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded">
                              Milestone
                            </span>
                            <span
                              className={`px-2 py-1 text-xs rounded ${
                                milestone.status === 'done'
                                  ? 'bg-green-100 text-green-800'
                                  : milestone.status === 'in_progress'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : milestone.status === 'blocked'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {milestone.status}
                            </span>
                            <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                              Priority: {milestone.priority}
                            </span>
                          </div>
                        </div>
                        {roadmapMilestone?.dependencies &&
                          roadmapMilestone.dependencies.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-200">
                              <p className="text-xs text-gray-500">
                                Dependencies: {roadmapMilestone.dependencies.join(', ')}
                              </p>
                            </div>
                          )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">No roadmap yet</p>
            <p className="text-sm text-gray-400 mb-6">
              Create a roadmap manually or generate one with AI based on your user stories.
            </p>
            <div className="flex justify-center space-x-3">
              <button
                onClick={() => setShowCreateForm(true)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Create Manually
              </button>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {generating ? 'Generating...' : 'Generate with AI'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

