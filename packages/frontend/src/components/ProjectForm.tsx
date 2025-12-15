import { useState } from 'react';
import { projectsApi } from '../api/projects';
import { CreateProjectRequest } from '@devflow-studio/shared';

interface ProjectFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ProjectForm({ onSuccess, onCancel }: ProjectFormProps) {
  const [formData, setFormData] = useState<CreateProjectRequest>({
    name: '',
    base_path: '',
    tech_stack: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await projectsApi.create(formData);
      onSuccess();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to create project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-4">Create New Project</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            Project Name
          </label>
          <input
            type="text"
            id="name"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="base_path" className="block text-sm font-medium text-gray-700 mb-1">
            Base Path
          </label>
          <input
            type="text"
            id="base_path"
            required
            value={formData.base_path}
            onChange={(e) => setFormData({ ...formData, base_path: e.target.value })}
            placeholder="/path/to/project"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="mt-1 text-sm text-gray-500">
            Full path where the project directory will be created
          </p>
        </div>

        <div>
          <label htmlFor="tech_stack" className="block text-sm font-medium text-gray-700 mb-1">
            Tech Stack (optional)
          </label>
          <input
            type="text"
            id="tech_stack"
            value={formData.tech_stack || ''}
            onChange={(e) => setFormData({ ...formData, tech_stack: e.target.value })}
            placeholder="React, Node.js, PostgreSQL"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div className="flex space-x-3">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Project'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

