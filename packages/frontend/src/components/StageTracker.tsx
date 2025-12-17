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
    return <div className="text-center py-4 text-gray-900 dark:text-white">Loading stages...</div>;
  }

  // Calculate overall project completion
  const overallCompletion = stages.length > 0
    ? Math.round(stages.reduce((sum, stage) => sum + stage.completion, 0) / stages.length)
    : 0;
  
  const completedStages = stages.filter(s => s.status === 'done').length;
  const totalStages = stages.length;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50">
      <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Project Stages</h2>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {completedStages}/{totalStages} stages completed
          </div>
        </div>
        
        {/* Overall progress bar */}
        <div className="mt-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Overall Progress</span>
            <span className="text-sm font-bold text-gray-900 dark:text-white">{overallCompletion}%</span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4">
            <div
              className="h-4 rounded-full bg-gradient-to-r from-blue-500 via-purple-500 to-green-500 transition-all duration-500"
              style={{ width: `${overallCompletion}%` }}
            />
          </div>
        </div>
      </div>
      <div className="p-6">
        <div className="space-y-4">
          {stages.map((stage) => (
            <div 
              key={stage.name} 
              className={`border-2 rounded-lg p-4 transition-all ${
                stage.status === 'done' 
                  ? 'border-green-300 dark:border-green-600 bg-green-50 dark:bg-green-900/20' 
                  : stage.status === 'in_progress' 
                  ? 'border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-blue-900/20' 
                  : stage.status === 'blocked' 
                  ? 'border-red-300 dark:border-red-600 bg-red-50 dark:bg-red-900/20' 
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    stage.status === 'done' ? 'bg-green-500' :
                    stage.status === 'in_progress' ? 'bg-blue-500' :
                    stage.status === 'blocked' ? 'bg-red-500' :
                    'bg-gray-300 dark:bg-gray-600'
                  }`}>
                    {stage.status === 'done' ? (
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : stage.status === 'in_progress' ? (
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ) : stage.status === 'blocked' ? (
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    ) : (
                      <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg text-gray-900 dark:text-white">{stageNames[stage.name] || stage.name}</h3>
                    <span
                      className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full font-medium ${
                        stage.status === 'done' ? 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200' :
                        stage.status === 'in_progress' ? 'bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200' :
                        stage.status === 'blocked' ? 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200' :
                        'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {stage.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">{Math.round(stage.completion)}%</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">complete</div>
                </div>
              </div>
              
              <div className="mb-3">
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-500 ${
                      stage.status === 'done' ? 'bg-green-500' :
                      stage.status === 'in_progress' ? 'bg-blue-500' :
                      stage.status === 'blocked' ? 'bg-red-500' :
                      'bg-gray-400 dark:bg-gray-600'
                    }`}
                    style={{ width: `${stage.completion}%` }}
                  />
                </div>
              </div>
              
              <div className="mt-3">
                <ul className="space-y-2">
                  {stage.checklist.map((item) => (
                    <li key={item.id} className="flex items-center text-sm">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mr-2 ${
                        item.completed 
                          ? 'bg-green-500 border-green-500' 
                          : 'border-gray-300 dark:border-gray-600'
                      }`}>
                        {item.completed && (
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <span className={item.completed ? 'text-gray-600 dark:text-gray-400' : 'text-gray-900 dark:text-white'}>
                        {item.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {stage.next_action && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center text-sm text-blue-600 dark:text-blue-400 font-medium">
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    Next: {stage.next_action}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

