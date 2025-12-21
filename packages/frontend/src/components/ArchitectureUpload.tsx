import { useState } from 'react';
import { artifactsApi } from '../api/artifacts';
import { ArtifactType } from '@devflow-studio/shared';

interface ArchitectureUploadProps {
  projectId: string;
  onUploaded: () => void;
}

export default function ArchitectureUpload({ projectId, onUploaded }: ArchitectureUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file');
      return;
    }

    setUploading(true);
    setError(null);

    try {
      await artifactsApi.upload(
        {
          project_id: projectId,
          type: 'architecture' as ArtifactType,
          path: `docs/ARCHITECTURE.${file.name.split('.').pop()}`,
          content: {},
        },
        file
      );
      onUploaded();
      setFile(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Upload Architecture Documentation</h3>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Select File (MD, PDF, etc.)
          </label>
          <input
            type="file"
            onChange={handleFileChange}
            accept=".md,.pdf,.txt"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </div>
    </div>
  );
}

