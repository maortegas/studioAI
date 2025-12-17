import { useEffect, useState } from 'react';
import { Release, ReleaseSummary, ReleaseStatus } from '@devflow-studio/shared';
import * as releasesApi from '../api/releases';
import { useToast } from '../context/ToastContext';

interface ReleaseManagerProps {
  projectId: string;
}

export default function ReleaseManager({ projectId }: ReleaseManagerProps) {
  const [releases, setReleases] = useState<Release[]>([]);
  const [summary, setSummary] = useState<ReleaseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingRelease, setEditingRelease] = useState<Release | null>(null);
  const { showToast } = useToast();

  const [formData, setFormData] = useState({
    version: '',
    title: '',
    description: '',
    changelog: '',
    release_notes: '',
    git_tag: '',
    release_date: '',
  });

  useEffect(() => {
    loadReleases();
  }, [projectId]);

  const loadReleases = async () => {
    try {
      setLoading(true);
      const [releasesData, summaryData] = await Promise.all([
        releasesApi.getReleasesByProject(projectId),
        releasesApi.getReleaseSummary(projectId),
      ]);
      setReleases(releasesData);
      setSummary(summaryData);
    } catch (error) {
      console.error('Failed to load releases:', error);
      showToast('Failed to load releases', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRelease = async () => {
    try {
      if (!formData.version) {
        showToast('Version is required', 'error');
        return;
      }

      const release = await releasesApi.createRelease({
        project_id: projectId,
        version: formData.version,
        title: formData.title || undefined,
        description: formData.description || undefined,
        changelog: formData.changelog || undefined,
        release_notes: formData.release_notes || undefined,
        git_tag: formData.git_tag || undefined,
        release_date: formData.release_date ? new Date(formData.release_date) : undefined,
      });

      showToast('Release created successfully', 'success');
      setShowCreateForm(false);
      resetForm();
      loadReleases();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to create release', 'error');
    }
  };

  const handlePublishRelease = async (id: string) => {
    try {
      await releasesApi.publishRelease(id);
      showToast('Release published successfully', 'success');
      loadReleases();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to publish release', 'error');
    }
  };

  const handleDeleteRelease = async (id: string) => {
    if (!confirm('Are you sure you want to delete this release?')) {
      return;
    }

    try {
      await releasesApi.deleteRelease(id);
      showToast('Release deleted successfully', 'success');
      loadReleases();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to delete release', 'error');
    }
  };

  const handleUpdateRelease = async (id: string, status: ReleaseStatus) => {
    try {
      await releasesApi.updateRelease(id, { status });
      showToast('Release updated successfully', 'success');
      loadReleases();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to update release', 'error');
    }
  };

  const resetForm = () => {
    setFormData({
      version: '',
      title: '',
      description: '',
      changelog: '',
      release_notes: '',
      git_tag: '',
      release_date: '',
    });
  };

  const getStatusColor = (status: ReleaseStatus) => {
    switch (status) {
      case 'draft':
        return 'bg-gray-100 text-gray-800';
      case 'ready':
        return 'bg-blue-100 text-blue-800';
      case 'published':
        return 'bg-green-100 text-green-800';
      case 'archived':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      {summary && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
          <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Release Summary</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Total Releases</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{summary.total_releases}</div>
            </div>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Published</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{summary.published_releases}</div>
            </div>
            <div>
              <div className="text-sm text-gray-600 dark:text-gray-400">Latest Version</div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{summary.latest_version || 'N/A'}</div>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Releases</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="bg-blue-600 dark:bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-700 dark:hover:bg-blue-600"
        >
          {showCreateForm ? 'Cancel' : 'Create Release'}
        </button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
          <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Create New Release</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Version <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.version}
                onChange={(e) => setFormData({ ...formData, version: e.target.value })}
                placeholder="e.g., 1.0.0"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Release title"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Release description"
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Release Notes</label>
              <textarea
                value={formData.release_notes}
                onChange={(e) => setFormData({ ...formData, release_notes: e.target.value })}
                placeholder="Release notes (markdown supported)"
                rows={5}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Git Tag</label>
                <input
                  type="text"
                  value={formData.git_tag}
                  onChange={(e) => setFormData({ ...formData, git_tag: e.target.value })}
                  placeholder="e.g., v1.0.0"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Release Date</label>
                <input
                  type="date"
                  value={formData.release_date}
                  onChange={(e) => setFormData({ ...formData, release_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => {
                  setShowCreateForm(false);
                  resetForm();
                }}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateRelease}
                className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-md hover:bg-blue-700 dark:hover:bg-blue-600"
              >
                Create Release
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Releases List */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 overflow-hidden">
        {releases.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            No releases yet. Create your first release to get started.
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {releases.map((release) => (
              <div key={release.id} className="p-6 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                        {release.title || `Release ${release.version}`}
                      </h3>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(release.status)}`}>
                        {release.status}
                      </span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">v{release.version}</span>
                    </div>
                    {release.description && (
                      <p className="text-gray-600 dark:text-gray-300 mb-2">{release.description}</p>
                    )}
                    <div className="flex items-center space-x-4 text-sm text-gray-500 dark:text-gray-400">
                      {release.release_date && (
                        <span>Released: {new Date(release.release_date).toLocaleDateString()}</span>
                      )}
                      {release.git_tag && <span>Tag: {release.git_tag}</span>}
                      <span>Created: {new Date(release.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    {release.status === 'draft' && (
                      <>
                        <button
                          onClick={() => handleUpdateRelease(release.id, 'ready')}
                          className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                        >
                          Mark Ready
                        </button>
                        <button
                          onClick={() => handlePublishRelease(release.id)}
                          className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200"
                        >
                          Publish
                        </button>
                        <button
                          onClick={() => handleDeleteRelease(release.id)}
                          className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200"
                        >
                          Delete
                        </button>
                      </>
                    )}
                    {release.status === 'ready' && (
                      <>
                        <button
                          onClick={() => handlePublishRelease(release.id)}
                          className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200"
                        >
                          Publish
                        </button>
                        <button
                          onClick={() => handleUpdateRelease(release.id, 'draft')}
                          className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                        >
                          Back to Draft
                        </button>
                      </>
                    )}
                    {release.status === 'published' && (
                      <button
                        onClick={() => handleUpdateRelease(release.id, 'archived')}
                        className="px-3 py-1 text-sm bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>
                {release.release_notes && (
                  <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded">
                    <h4 className="font-medium mb-2 text-gray-900 dark:text-white">Release Notes</h4>
                    <div className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                      {release.release_notes}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
