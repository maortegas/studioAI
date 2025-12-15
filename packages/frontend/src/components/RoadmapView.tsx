import { useEffect, useState } from 'react';
import { roadmapApi } from '../api/roadmap';
import { tasksApi } from '../api/tasks';
import { Task } from '@devflow-studio/shared';

interface RoadmapViewProps {
  projectId: string;
}

export default function RoadmapView({ projectId }: RoadmapViewProps) {
  const [milestones, setMilestones] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadRoadmap();
  }, [projectId]);

  const loadRoadmap = async () => {
    try {
      const data = await roadmapApi.getByProject(projectId);
      setMilestones(data.milestones || []);
    } catch (error) {
      console.error('Failed to load roadmap:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await roadmapApi.generate(projectId);
      // Reload after a delay to see the new roadmap
      setTimeout(() => {
        loadRoadmap();
      }, 2000);
    } catch (error) {
      console.error('Failed to generate roadmap:', error);
      alert('Failed to generate roadmap');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return <div className="text-center py-4">Loading roadmap...</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="border-b border-gray-200 px-6 py-4 flex justify-between items-center">
        <h2 className="text-xl font-semibold">Roadmap</h2>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
        >
          {generating ? 'Generating...' : 'Generate Roadmap'}
        </button>
      </div>
      <div className="p-6">
        {milestones.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">No roadmap yet</p>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate Roadmap with AI'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {milestones.map((milestone) => (
              <div key={milestone.id} className="border border-gray-200 rounded-lg p-4">
                <h3 className="font-semibold text-lg">{milestone.title}</h3>
                {milestone.description && (
                  <p className="text-sm text-gray-600 mt-2">{milestone.description}</p>
                )}
                <div className="mt-2 flex items-center space-x-2">
                  <span className="px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded">
                    Milestone
                  </span>
                  <span
                    className={`px-2 py-1 text-xs rounded ${
                      milestone.status === 'done'
                        ? 'bg-green-100 text-green-800'
                        : milestone.status === 'in_progress'
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {milestone.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

