import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { projectsApi } from '../api/projects';
import { tasksApi } from '../api/tasks';
import { Project, Task } from '@devflow-studio/shared';
import PRDEditor from '../components/PRDEditor';
import StageTracker from '../components/StageTracker';
import AIJobRunner from '../components/AIJobRunner';
import ArchitectureManager from '../components/ArchitectureManager';
import UserStoriesManager from '../components/UserStoriesManager';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'prd' | 'design' | 'stories' | 'stages' | 'tasks' | 'ai'>(
    'overview'
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadProject();
      loadTasks();
    }
  }, [id]);

  const loadProject = async () => {
    if (!id) return;
    try {
      const data = await projectsApi.getById(id);
      setProject(data);
    } catch (error) {
      console.error('Failed to load project:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadTasks = async () => {
    if (!id) return;
    try {
      const data = await tasksApi.getByProject(id);
      setTasks(data);
    } catch (error) {
      console.error('Failed to load tasks:', error);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (!project) {
    return <div className="text-center py-8">Project not found</div>;
  }

  return (
    <div className="px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{project.name}</h1>
        <p className="text-gray-600">Path: {project.base_path}</p>
        {project.tech_stack && <p className="text-gray-600">Stack: {project.tech_stack}</p>}
      </div>

      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          {(['overview', 'prd', 'design', 'stories', 'stages', 'tasks', 'ai'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      <div>
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-lg shadow">
              <h2 className="text-xl font-semibold mb-4">Project Overview</h2>
              <div className="space-y-2">
                <p>
                  <strong>Name:</strong> {project.name}
                </p>
                <p>
                  <strong>Base Path:</strong> {project.base_path}
                </p>
                {project.tech_stack && (
                  <p>
                    <strong>Tech Stack:</strong> {project.tech_stack}
                  </p>
                )}
                <p>
                  <strong>Created:</strong> {new Date(project.created_at).toLocaleString()}
                </p>
              </div>
            </div>
            <StageTracker projectId={project.id} />
          </div>
        )}

        {activeTab === 'prd' && <PRDEditor projectId={project.id} />}

        {activeTab === 'design' && <ArchitectureManager projectId={project.id} />}

        {activeTab === 'stories' && <UserStoriesManager projectId={project.id} />}

        {activeTab === 'stages' && <StageTracker projectId={project.id} />}

        {activeTab === 'tasks' && (
          <div className="bg-white rounded-lg shadow">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-xl font-semibold">Tasks</h2>
            </div>
            <div className="p-6">
              {tasks.length === 0 ? (
                <p className="text-gray-500">No tasks yet</p>
              ) : (
                <div className="space-y-2">
                  {tasks.map((task) => (
                    <div key={task.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-semibold">{task.title}</h3>
                          {task.description && (
                            <p className="text-sm text-gray-600 mt-1">{task.description}</p>
                          )}
                        </div>
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                            {task.type}
                          </span>
                          <span className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded">
                            {task.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'ai' && <AIJobRunner projectId={project.id} />}
      </div>
    </div>
  );
}

