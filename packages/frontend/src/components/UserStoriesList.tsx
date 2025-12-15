import { useEffect, useState } from 'react';
import { tasksApi } from '../api/tasks';
import { Task } from '@devflow-studio/shared';

interface UserStoriesListProps {
  projectId: string;
}

export default function UserStoriesList({ projectId }: UserStoriesListProps) {
  const [stories, setStories] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStories();
  }, [projectId]);

  const loadStories = async () => {
    try {
      const data = await tasksApi.getByProjectAndType(projectId, 'story');
      setStories(data);
    } catch (error) {
      console.error('Failed to load user stories:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-4">Loading...</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-xl font-semibold">User Stories</h2>
      </div>
      <div className="p-6">
        {stories.length === 0 ? (
          <p className="text-gray-500">No user stories yet</p>
        ) : (
          <div className="space-y-4">
            {stories.map((story) => (
              <div key={story.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="font-semibold">{story.title}</h3>
                    {story.description && (
                      <p className="text-sm text-gray-600 mt-1">{story.description}</p>
                    )}
                  </div>
                  <div className="flex items-center space-x-2 ml-4">
                    <span
                      className={`px-2 py-1 text-xs rounded ${
                        story.status === 'done'
                          ? 'bg-green-100 text-green-800'
                          : story.status === 'in_progress'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}
                    >
                      {story.status}
                    </span>
                    <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                      Priority: {story.priority}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

