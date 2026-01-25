import { Project } from '@devflow-studio/shared';
import StageTracker from '../../components/StageTracker';
import DatabaseSetup from '../../components/DatabaseSetup';

interface OverviewTabProps {
  project: Project;
}

export default function OverviewTab({ project }: OverviewTabProps) {
  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-700/50">
        <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Project Overview</h2>
        <div className="space-y-2 text-gray-900 dark:text-gray-200">
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
      <DatabaseSetup projectId={project.id} />
      <StageTracker projectId={project.id} />
    </div>
  );
}

