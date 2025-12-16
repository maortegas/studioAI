import { Task, RoadmapMilestone } from '@devflow-studio/shared';

interface RoadmapTimelineProps {
  milestones: Task[];
  roadmapMilestones: RoadmapMilestone[];
}

export default function RoadmapTimeline({ milestones, roadmapMilestones }: RoadmapTimelineProps) {
  const sortedMilestones = [...milestones].sort((a, b) => {
    // First by status (done < in_progress < todo < blocked)
    const statusOrder = { done: 0, in_progress: 1, todo: 2, blocked: 3 };
    const statusDiff = (statusOrder[a.status as keyof typeof statusOrder] || 2) - 
                       (statusOrder[b.status as keyof typeof statusOrder] || 2);
    if (statusDiff !== 0) return statusDiff;
    
    // Then by priority (higher first)
    return b.priority - a.priority;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'done':
        return 'bg-green-500';
      case 'in_progress':
        return 'bg-yellow-500';
      case 'blocked':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };

  const getStatusBorderColor = (status: string) => {
    switch (status) {
      case 'done':
        return 'border-green-500';
      case 'in_progress':
        return 'border-yellow-500';
      case 'blocked':
        return 'border-red-500';
      default:
        return 'border-gray-400';
    }
  };

  const calculateProgress = () => {
    if (milestones.length === 0) return 0;
    const completed = milestones.filter(m => m.status === 'done').length;
    return Math.round((completed / milestones.length) * 100);
  };

  const progress = calculateProgress();

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-lg font-semibold">Project Timeline</h3>
          <span className="text-sm text-gray-600">{progress}% Complete</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-gradient-to-r from-blue-500 to-green-500 h-3 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-300" />

        {/* Milestones */}
        <div className="space-y-8">
          {sortedMilestones.map((milestone, index) => {
            const roadmapData = roadmapMilestones.find(rm => rm.id === milestone.id);
            const isLast = index === sortedMilestones.length - 1;

            return (
              <div key={milestone.id} className="relative flex items-start">
                {/* Timeline dot */}
                <div className={`
                  absolute left-6 -translate-x-1/2 w-4 h-4 rounded-full border-4 border-white
                  ${getStatusColor(milestone.status)}
                  ${milestone.status === 'in_progress' ? 'animate-pulse' : ''}
                `} />

                {/* Content card */}
                <div className={`
                  ml-16 flex-1 pb-8 
                  ${!isLast ? 'border-l-2 border-gray-200 pl-4' : 'pl-4'}
                `}>
                  <div className={`
                    border-2 rounded-lg p-4 bg-white transition-all hover:shadow-lg
                    ${getStatusBorderColor(milestone.status)}
                  `}>
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-semibold text-gray-900">{milestone.title}</h4>
                      <div className="flex items-center space-x-2">
                        <span className={`
                          px-2 py-1 text-xs rounded-full font-medium
                          ${milestone.status === 'done' ? 'bg-green-100 text-green-800' :
                            milestone.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                            milestone.status === 'blocked' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'}
                        `}>
                          {milestone.status}
                        </span>
                        <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full font-medium">
                          P{milestone.priority}
                        </span>
                      </div>
                    </div>

                    {milestone.description && (
                      <p className="text-sm text-gray-600 mb-3 whitespace-pre-wrap">
                        {milestone.description}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                      {roadmapData?.targetDate && (
                        <div className="flex items-center space-x-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <span>{new Date(roadmapData.targetDate).toLocaleDateString()}</span>
                        </div>
                      )}
                      
                      {roadmapData?.dependencies && roadmapData.dependencies.length > 0 && (
                        <div className="flex items-center space-x-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          <span>{roadmapData.dependencies.length} dependencies</span>
                        </div>
                      )}

                      {milestone.created_at && (
                        <div className="flex items-center space-x-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>Created {new Date(milestone.created_at).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Status Legend</h4>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-gray-400" />
              <span className="text-xs text-gray-600">Todo</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500 animate-pulse" />
              <span className="text-xs text-gray-600">In Progress</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-xs text-gray-600">Done</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-xs text-gray-600">Blocked</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
