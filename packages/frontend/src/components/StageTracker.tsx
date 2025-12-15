import { useEffect, useState } from 'react';
import { stagesApi } from '../api/stages';
import { ProjectStage } from '@devflow-studio/shared';

interface StageTrackerProps {
  projectId: string;
}

const stageNames: Record<string, string> = {
  idea: 'Idea',
  design: 'Design',
  stories: 'User Stories',
  roadmap: 'Roadmap',
  implementation: 'Implementation',
  qa: 'QA',
  release: 'Release',
};

const statusColors: Record<string, string> = {
  not_started: 'bg-gray-200',
  in_progress: 'bg-yellow-400',
  blocked: 'bg-red-400',
  done: 'bg-green-400',
};

export default function StageTracker({ projectId }: StageTrackerProps) {
  const [stages, setStages] = useState<ProjectStage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStages();
    
    // Listen for artifact updates to refresh stages
    const handleArtifactUpdate = (event: CustomEvent) => {
      if (event.detail.projectId === projectId) {
        loadStages();
      }
    };
    
    window.addEventListener('artifactUpdated' as any, handleArtifactUpdate);
    
    return () => {
      window.removeEventListener('artifactUpdated' as any, handleArtifactUpdate);
    };
  }, [projectId]);

  const loadStages = async () => {
    try {
      const data = await stagesApi.getByProject(projectId);
      setStages(data);
    } catch (error) {
      console.error('Failed to load stages:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-4">Loading stages...</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-xl font-semibold">Project Stages</h2>
      </div>
      <div className="p-6">
        <div className="space-y-4">
          {stages.map((stage) => (
            <div key={stage.name} className="border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{stageNames[stage.name] || stage.name}</h3>
                <div className="flex items-center space-x-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2 w-32">
                    <div
                      className={`h-2 rounded-full ${statusColors[stage.status]}`}
                      style={{ width: `${stage.completion}%` }}
                    />
                  </div>
                  <span className="text-sm text-gray-600">{stage.completion}%</span>
                  <span
                    className={`px-2 py-1 text-xs rounded ${statusColors[stage.status]} text-white`}
                  >
                    {stage.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
              <div className="mt-2">
                <ul className="space-y-1">
                  {stage.checklist.map((item) => (
                    <li key={item.id} className="flex items-center text-sm">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        readOnly
                        className="mr-2"
                      />
                      <span className={item.completed ? 'text-gray-500 line-through' : ''}>
                        {item.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {stage.next_action && (
                <div className="mt-2 text-sm text-blue-600">
                  Next: {stage.next_action}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

