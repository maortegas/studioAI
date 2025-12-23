import { useState, useEffect, useRef } from 'react';
import { designApi } from '../api/design';
import { aiJobsApi } from '../api/aiJobs';
import { Prototype } from '@devflow-studio/shared';
import { useToast } from '../context/ToastContext';
import LoadingSpinner from './LoadingSpinner';
import PrototypeViewer from './PrototypeViewer';

interface PrototypesManagerProps {
  projectId: string;
}

export default function PrototypesManager({ projectId }: PrototypesManagerProps) {
  const [prototypes, setPrototypes] = useState<Prototype[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedPrototype, setSelectedPrototype] = useState<Prototype | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadPrototypes();
  }, [projectId]);

  // Poll for job completion
  useEffect(() => {
    if (currentJobId && uploading) {
      const checkJobStatus = async () => {
        try {
          const job = await aiJobsApi.getById(currentJobId);
          
          if (job.status === 'completed') {
            setUploading(false);
            setCurrentJobId(null);
            showToast('Prototype analysis completed!', 'success');
            await loadPrototypes();
          } else if (job.status === 'failed') {
            setUploading(false);
            setCurrentJobId(null);
            showToast('Prototype analysis failed', 'error');
          } else {
            setTimeout(checkJobStatus, 2000);
          }
        } catch (error) {
          console.error('Failed to check job status:', error);
          setTimeout(checkJobStatus, 2000);
        }
      };
      
      checkJobStatus();
    }
  }, [currentJobId, uploading, showToast]);

  const loadPrototypes = async () => {
    try {
      setLoading(true);
      const data = await designApi.getPrototypesByProject(projectId);
      setPrototypes(data);
    } catch (error) {
      console.error('Failed to load prototypes:', error);
      showToast('Failed to load prototypes', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      showToast('Please select a valid image file (JPEG, PNG, GIF, or WebP)', 'error');
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      showToast('File size must be less than 10MB', 'error');
      return;
    }

    setUploading(true);
    try {
      const result = await designApi.analyzePrototype(projectId, file);
      setCurrentJobId(result.job_id);
      showToast('Prototype uploaded. Analysis in progress...', 'info');
      
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error: any) {
      console.error('Failed to upload prototype:', error);
      showToast(error.response?.data?.error || 'Failed to upload prototype', 'error');
      setUploading(false);
    }
  };

  if (selectedPrototype) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelectedPrototype(null)}
          className="mb-4 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded hover:bg-gray-300 dark:hover:bg-gray-600"
        >
          ← Back to Prototypes
        </button>
        <PrototypeViewer prototype={selectedPrototype} />
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Prototypes</h2>
        <label className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 cursor-pointer">
          {uploading ? 'Uploading...' : '+ Upload Prototype'}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
            onChange={handleFileSelect}
            className="hidden"
            disabled={uploading}
          />
        </label>
      </div>

      {prototypes.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 p-8 rounded-lg shadow dark:shadow-gray-700/50 text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            No prototypes yet. Upload one to get started!
          </p>
          <label className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 cursor-pointer">
            Upload Prototype
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
              onChange={handleFileSelect}
              className="hidden"
              disabled={uploading}
            />
          </label>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {prototypes.map((prototype) => (
            <div
              key={prototype.id}
              className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 overflow-hidden hover:shadow-lg dark:hover:shadow-gray-600/50 transition-shadow cursor-pointer"
              onClick={() => setSelectedPrototype(prototype)}
            >
              <div className="aspect-video bg-gray-100 dark:bg-gray-700 overflow-hidden">
                <img
                  src={`/api/design/prototypes/${prototype.id}/image`}
                  alt={prototype.file_name}
                  className="w-full h-full object-contain"
                  onError={() => {
                    console.error('Failed to load image:', prototype.file_path);
                  }}
                />
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 dark:text-white truncate mb-1">
                  {prototype.file_name}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-500">
                  {new Date(prototype.uploaded_at).toLocaleString()}
                </p>
                {prototype.analysis_result ? (
                  <span className="inline-block mt-2 px-2 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-full text-xs">
                    Analyzed
                  </span>
                ) : (
                  <span className="inline-block mt-2 px-2 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 rounded-full text-xs">
                    Analyzing...
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
