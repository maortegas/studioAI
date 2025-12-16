import { useState } from 'react';
import { RoadmapMilestone, CreateRoadmapRequest } from '@devflow-studio/shared';
import { roadmapApi } from '../api/roadmap';
import { useToast } from '../context/ToastContext';

interface RoadmapEditorProps {
  projectId: string;
  initialTitle?: string;
  initialDescription?: string;
  initialMilestones?: RoadmapMilestone[];
  onSuccess: () => void;
  onCancel: () => void;
}

export default function RoadmapEditor({
  projectId,
  initialTitle = '',
  initialDescription = '',
  initialMilestones = [],
  onSuccess,
  onCancel,
}: RoadmapEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [milestones, setMilestones] = useState<RoadmapMilestone[]>(
    initialMilestones.length > 0
      ? initialMilestones
      : [
          {
            title: '',
            description: '',
            status: 'todo',
            priority: 0,
            targetDate: '',
            dependencies: [],
          },
        ]
  );
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();

  const addMilestone = () => {
    setMilestones([
      ...milestones,
      {
        title: '',
        description: '',
        status: 'todo',
        priority: milestones.length,
        targetDate: '',
        dependencies: [],
      },
    ]);
  };

  const removeMilestone = (index: number) => {
    setMilestones(milestones.filter((_, i) => i !== index));
  };

  const updateMilestone = (index: number, updates: Partial<RoadmapMilestone>) => {
    const updated = [...milestones];
    updated[index] = { ...updated[index], ...updates };
    setMilestones(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim()) {
      showToast('Title is required', 'error');
      return;
    }

    if (milestones.length === 0) {
      showToast('At least one milestone is required', 'error');
      return;
    }

    // Validate milestones
    for (const milestone of milestones) {
      if (!milestone.title.trim()) {
        showToast('All milestones must have a title', 'error');
        return;
      }
    }

    setSaving(true);
    try {
      const data: CreateRoadmapRequest = {
        project_id: projectId,
        title: title.trim(),
        description: description.trim() || undefined,
        milestones: milestones.map((m) => ({
          title: m.title.trim(),
          description: m.description.trim() || undefined,
          status: m.status,
          priority: m.priority,
          targetDate: m.targetDate || undefined,
          dependencies: m.dependencies || [],
        })),
      };

      await roadmapApi.create(data);
      showToast('Roadmap created successfully!', 'success');
      onSuccess();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to create roadmap', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Roadmap Title *
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="e.g., Q1 2024 Product Roadmap"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Optional description of the roadmap..."
        />
      </div>

      <div>
        <div className="flex justify-between items-center mb-4">
          <label className="block text-sm font-medium text-gray-700">
            Milestones *
          </label>
          <button
            type="button"
            onClick={addMilestone}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            + Add Milestone
          </button>
        </div>

        <div className="space-y-4">
          {milestones.map((milestone, index) => (
            <div
              key={index}
              className="border border-gray-200 rounded-lg p-4 bg-gray-50"
            >
              <div className="flex justify-between items-start mb-3">
                <h4 className="font-medium text-gray-700">Milestone {index + 1}</h4>
                {milestones.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeMilestone(index)}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Title *
                  </label>
                  <input
                    type="text"
                    value={milestone.title}
                    onChange={(e) =>
                      updateMilestone(index, { title: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., MVP Launch"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Description
                  </label>
                  <textarea
                    value={milestone.description || ''}
                    onChange={(e) =>
                      updateMilestone(index, { description: e.target.value })
                    }
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional description..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Status
                    </label>
                    <select
                      value={milestone.status}
                      onChange={(e) =>
                        updateMilestone(index, {
                          status: e.target.value as RoadmapMilestone['status'],
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="todo">Todo</option>
                      <option value="in_progress">In Progress</option>
                      <option value="blocked">Blocked</option>
                      <option value="done">Done</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Priority
                    </label>
                    <input
                      type="number"
                      value={milestone.priority}
                      onChange={(e) =>
                        updateMilestone(index, {
                          priority: parseInt(e.target.value) || 0,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                      min="0"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Target Date (optional)
                  </label>
                  <input
                    type="date"
                    value={milestone.targetDate || ''}
                    onChange={(e) =>
                      updateMilestone(index, { targetDate: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Creating...' : 'Create Roadmap'}
        </button>
      </div>
    </form>
  );
}

