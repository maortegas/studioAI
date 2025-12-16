import { useEffect, useState } from 'react';
import { CodingSession, Task, ImplementationDashboard as IDashboard } from '@devflow-studio/shared';
import { codingSessionsApi } from '../api/codingSessions';
import { tasksApi } from '../api/tasks';
import { useToast } from '../context/ToastContext';
import CodingSessionViewer from './CodingSessionViewer';

interface ImplementationDashboardProps {
  projectId: string;
}

export default function ImplementationDashboard({ projectId }: ImplementationDashboardProps) {
  const [dashboard, setDashboard] = useState<IDashboard | null>(null);
  const [stories, setStories] = useState<Task[]>([]);
  const [selectedStories, setSelectedStories] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [viewingSession, setViewingSession] = useState<CodingSession | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadData();
    
    // Poll for updates every 3 seconds
    const interval = setInterval(loadDashboard, 3000);
    return () => clearInterval(interval);
  }, [projectId]);

  const loadData = async () => {
    await Promise.all([loadDashboard(), loadStories()]);
    setLoading(false);
  };

  const loadDashboard = async () => {
    try {
      const data = await codingSessionsApi.getDashboard(projectId);
      setDashboard(data);
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    }
  };

  const loadStories = async () => {
    try {
      const allTasks = await tasksApi.getByProject(projectId);
      const userStories = allTasks.filter((t: Task) => t.type === 'story');
      setStories(userStories);
    } catch (error) {
      console.error('Failed to load stories:', error);
    }
  };

  const toggleStorySelection = (storyId: string) => {
    const newSelection = new Set(selectedStories);
    if (newSelection.has(storyId)) {
      newSelection.delete(storyId);
    } else {
      newSelection.add(storyId);
    }
    setSelectedStories(newSelection);
  };

  const handleStartImplementation = async () => {
    if (selectedStories.size === 0) {
      showToast('Please select at least one user story', 'error');
      return;
    }

    setStarting(true);
    try {
      const result = await codingSessionsApi.startImplementation({
        project_id: projectId,
        story_ids: Array.from(selectedStories),
        auto_assign: true,
      });

      showToast(result.message, 'success');
      setSelectedStories(new Set());
      await loadDashboard();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to start implementation', 'error');
    } finally {
      setStarting(false);
    }
  };

  const handlePauseSession = async (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await codingSessionsApi.pauseSession(sessionId);
      showToast('Session paused', 'success');
      await loadDashboard();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to pause session', 'error');
    }
  };

  const handleResumeSession = async (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await codingSessionsApi.resumeSession(sessionId);
      showToast('Session resumed', 'success');
      await loadDashboard();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to resume session', 'error');
    }
  };

  const handleDeleteSession = async (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (!confirm('Are you sure you want to cancel/delete this session?')) {
      return;
    }
    try {
      await codingSessionsApi.deleteSession(sessionId);
      showToast('Session deleted', 'success');
      await loadDashboard();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to delete session', 'error');
    }
  };

  const handleRetrySession = async (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const result = await codingSessionsApi.retrySession(sessionId);
      showToast(result.message, 'success');
      await loadDashboard();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to retry session', 'error');
    }
  };

  const getStorySession = (storyId: string): CodingSession | undefined => {
    return dashboard?.sessions.find((s) => s.story_id === storyId);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'running':
        return 'bg-blue-100 text-blue-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getProgrammerBadge = (type: string) => {
    const colors = {
      backend: 'bg-purple-100 text-purple-800',
      frontend: 'bg-pink-100 text-pink-800',
      fullstack: 'bg-indigo-100 text-indigo-800',
    };
    return colors[type as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  if (loading) {
    return <div className="text-center py-8">Loading implementation dashboard...</div>;
  }

  const availableStories = stories.filter((story) => !getStorySession(story.id));
  const activeSessions = dashboard?.sessions.filter((s) => 
    s.status === 'running' || s.status === 'pending' || s.status === 'paused'
  ) || [];

  return (
    <div className="space-y-6">
      {/* Statistics */}
      {dashboard && (
        <div className="grid grid-cols-5 gap-4">
          <div className="bg-white rounded-lg shadow p-4 border-t-4 border-blue-500">
            <div className="text-2xl font-bold text-gray-900">{dashboard.total_stories}</div>
            <div className="text-sm text-gray-600">Total Stories</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border-t-4 border-green-500">
            <div className="text-2xl font-bold text-gray-900">{dashboard.completed_stories}</div>
            <div className="text-sm text-gray-600">Completed</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border-t-4 border-yellow-500">
            <div className="text-2xl font-bold text-gray-900">{dashboard.in_progress}</div>
            <div className="text-sm text-gray-600">In Progress</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border-t-4 border-gray-500">
            <div className="text-2xl font-bold text-gray-900">{dashboard.pending}</div>
            <div className="text-sm text-gray-600">Pending</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4 border-t-4 border-red-500">
            <div className="text-2xl font-bold text-gray-900">{dashboard.failed}</div>
            <div className="text-sm text-gray-600">Failed</div>
          </div>
        </div>
      )}

      {/* Active Sessions */}
      {activeSessions.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-xl font-semibold">Active Coding Sessions</h2>
          </div>
          <div className="p-6 space-y-3">
            {activeSessions.map((session) => {
              const story = stories.find((s) => s.id === session.story_id);
              return (
                <div
                  key={session.id}
                  className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex-1 cursor-pointer" onClick={() => setViewingSession(session)}>
                      <div className="flex items-center space-x-2 mb-2">
                        <span className={`px-2 py-1 text-xs rounded-full font-medium ${getProgrammerBadge(session.programmer_type)}`}>
                          {session.programmer_type}
                        </span>
                        <span className={`px-2 py-1 text-xs rounded-full font-medium ${getStatusColor(session.status)}`}>
                          {session.status}
                        </span>
                      </div>
                      <h3 className="font-semibold text-gray-900">{story?.title || 'Unknown Story'}</h3>
                      {session.current_file && (
                        <p className="text-xs text-gray-500 mt-1 font-mono">📄 {session.current_file}</p>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 ml-4">
                      <div className="text-right mr-2">
                        <div className="text-2xl font-bold text-gray-900">{session.progress}%</div>
                        <div className="text-xs text-gray-500">progress</div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {session.status === 'running' && (
                          <button
                            onClick={(e) => handlePauseSession(session.id, e)}
                            className="flex items-center space-x-1 px-3 py-2 text-sm bg-yellow-100 text-yellow-700 hover:bg-yellow-200 rounded-lg transition border border-yellow-300"
                            title="Pause session"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>Pause</span>
                          </button>
                        )}
                        {session.status === 'paused' && (
                          <button
                            onClick={(e) => handleResumeSession(session.id, e)}
                            className="flex items-center space-x-1 px-3 py-2 text-sm bg-green-100 text-green-700 hover:bg-green-200 rounded-lg transition border border-green-300"
                            title="Resume session"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>Resume</span>
                          </button>
                        )}
                        {session.status === 'pending' && (
                          <span className="flex items-center space-x-1 px-3 py-2 text-sm bg-blue-100 text-blue-700 rounded-lg border border-blue-300">
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span>Waiting...</span>
                          </span>
                        )}
                        <button
                          onClick={(e) => handleDeleteSession(session.id, e)}
                          className="flex items-center space-x-1 px-3 py-2 text-sm bg-red-100 text-red-700 hover:bg-red-200 rounded-lg transition border border-red-300"
                          title="Cancel/Delete session"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          <span>Cancel</span>
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-500 ${
                          session.status === 'running'
                            ? 'bg-gradient-to-r from-blue-500 to-green-500'
                            : session.status === 'paused'
                            ? 'bg-yellow-500'
                            : 'bg-gray-400'
                        }`}
                        style={{ width: `${session.progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Start Implementation */}
      {availableStories.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200 px-6 py-4 flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold">Start Implementation</h2>
              <p className="text-sm text-gray-500 mt-1">
                Select user stories to assign to AI developers
              </p>
            </div>
            <button
              onClick={handleStartImplementation}
              disabled={selectedStories.size === 0 || starting}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {starting ? 'Starting...' : `Start ${selectedStories.size} Selected`}
            </button>
          </div>
          <div className="p-6">
            <div className="space-y-2">
              {availableStories.map((story) => (
                <label
                  key={story.id}
                  className="flex items-center space-x-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition"
                >
                  <input
                    type="checkbox"
                    checked={selectedStories.has(story.id)}
                    onChange={() => toggleStorySelection(story.id)}
                    className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{story.title}</div>
                    {story.description && (
                      <div className="text-sm text-gray-500 mt-1 line-clamp-1">
                        {story.description}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded">
                      Priority: {story.priority}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Completed/Failed Sessions */}
      {dashboard && dashboard.sessions.filter((s) => s.status === 'completed' || s.status === 'failed').length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-xl font-semibold">Session History</h2>
          </div>
          <div className="p-6">
            <div className="space-y-2">
              {dashboard.sessions
                .filter((s) => s.status === 'completed' || s.status === 'failed')
                .map((session) => {
                  const story = stories.find((s) => s.id === session.story_id);
                  return (
                    <div
                      key={session.id}
                      className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition"
                    >
                      <div className="flex justify-between items-center">
                        <div className="flex items-center space-x-3 flex-1 cursor-pointer" onClick={() => setViewingSession(session)}>
                          <span className={`px-2 py-1 text-xs rounded-full font-medium ${getProgrammerBadge(session.programmer_type)}`}>
                            {session.programmer_type}
                          </span>
                          <span className={`px-2 py-1 text-xs rounded-full font-medium ${getStatusColor(session.status)}`}>
                            {session.status}
                          </span>
                          <span className="font-medium text-gray-900">{story?.title || 'Unknown Story'}</span>
                        </div>
                        <div className="flex items-center space-x-3">
                          <div className="text-xs text-gray-500">
                            {session.completed_at && new Date(session.completed_at).toLocaleString()}
                          </div>
                          {session.status === 'failed' && (
                            <button
                              onClick={(e) => handleRetrySession(session.id, e)}
                              className="flex items-center space-x-1 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              <span>Retry</span>
                            </button>
                          )}
                          <button
                            onClick={(e) => handleDeleteSession(session.id, e)}
                            className="flex items-center space-x-1 px-3 py-2 text-sm bg-red-100 text-red-700 hover:bg-red-200 rounded-lg transition border border-red-300"
                            title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Session Viewer Modal */}
      {viewingSession && (
        <CodingSessionViewer
          session={viewingSession}
          onClose={() => setViewingSession(null)}
        />
      )}
    </div>
  );
}
