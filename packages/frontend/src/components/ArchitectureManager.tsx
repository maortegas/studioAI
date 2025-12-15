import { useState, useEffect } from 'react';
import { artifactsApi } from '../api/artifacts';
import { Artifact } from '@devflow-studio/shared';
import ReactMarkdown from 'react-markdown';
import { useSSE } from '../hooks/useSSE';
import { useToast } from '../context/ToastContext';

interface ArchitectureManagerProps {
  projectId: string;
}

export default function ArchitectureManager({ projectId }: ArchitectureManagerProps) {
  const [architecture, setArchitecture] = useState<Artifact | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const { showToast } = useToast();
  const { events } = useSSE();

  useEffect(() => {
    loadArchitecture();
  }, [projectId]);

  const [currentJobId, setCurrentJobId] = useState<string | null>(null);

  // Listen for AI job completion
  useEffect(() => {
    if (currentJobId && generating) {
      // Poll for job completion
      const checkJobStatus = async () => {
        try {
          const { aiJobsApi } = await import('../api/aiJobs');
          const job = await aiJobsApi.getById(currentJobId);
          
          if (job.status === 'completed') {
            try {
              // Get the result
              const result = await aiJobsApi.getResult(currentJobId);
              
              // Set the content so user can review and save
              setContent(result.output);
              setGenerating(false);
              setCurrentJobId(null);
              showToast('Architecture generated! Review and save when ready.', 'success');
              
              // Reload to show the architecture
              await loadArchitecture();
            } catch (error) {
              console.error('Failed to get job result:', error);
            }
          } else if (job.status === 'failed') {
            setGenerating(false);
            setCurrentJobId(null);
            showToast('Architecture generation failed', 'error');
          } else {
            // Still running, check again in 2 seconds
            setTimeout(checkJobStatus, 2000);
          }
        } catch (error) {
          console.error('Failed to check job status:', error);
          setTimeout(checkJobStatus, 2000);
        }
      };
      
      checkJobStatus();
    }
  }, [currentJobId, generating, showToast]);

  const loadArchitecture = async () => {
    try {
      const artifacts = await artifactsApi.getByProject(projectId);
      const arch = artifacts.find((a) => a.type === 'architecture');
      
      if (arch) {
        setArchitecture(arch);
        try {
          const data = await artifactsApi.getContent(arch.id);
          setContent(data.content);
        } catch (error) {
          console.error('Failed to load architecture content:', error);
        }
      }
    } catch (error) {
      console.error('Failed to load architecture:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await artifactsApi.generateArchitecture(projectId);
      setCurrentJobId(result.job_id);
      showToast('Architecture generation started. This may take a few minutes...', 'info');
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to generate architecture', 'error');
      setGenerating(false);
      setCurrentJobId(null);
    }
  };

  const handleSave = async () => {
    setUploading(true);
    try {
      await artifactsApi.saveArchitecture(projectId, content);
      showToast('Architecture saved successfully!', 'success');
      await loadArchitecture();
      // Trigger stage refresh by dispatching a custom event
      window.dispatchEvent(new CustomEvent('artifactUpdated', { detail: { projectId } }));
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to save architecture', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async () => {
    if (!file) {
      showToast('Please select a file', 'error');
      return;
    }

    setUploading(true);
    try {
      const fileContent = await file.text();
      await artifactsApi.saveArchitecture(projectId, fileContent);
      showToast('Architecture uploaded successfully!', 'success');
      setFile(null);
      setShowUpload(false);
      await loadArchitecture();
      // Trigger stage refresh
      window.dispatchEvent(new CustomEvent('artifactUpdated', { detail: { projectId } }));
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to upload architecture', 'error');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading architecture...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-semibold">Architecture Documentation</h2>
          <div className="flex space-x-2">
            <button
              onClick={() => setShowUpload(!showUpload)}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              {showUpload ? 'Cancel Upload' : 'Upload File'}
            </button>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate with AI'}
            </button>
          </div>
        </div>

        {showUpload && (
          <div className="p-6 border-b border-gray-200">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Select File (MD, TXT, etc.)
                </label>
                <input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  accept=".md,.txt"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={handleFileUpload}
                disabled={!file || uploading}
                className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {uploading ? 'Uploading...' : 'Upload Architecture'}
              </button>
            </div>
          </div>
        )}

        <div className="p-6">
          {architecture ? (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-sm text-gray-600">
                  Last updated: {new Date(architecture.created_at).toLocaleString()}
                </p>
                <div className="flex space-x-2">
                  <button
                    onClick={() => setPreview(!preview)}
                    className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    {preview ? 'Edit' : 'Preview'}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={uploading}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                  >
                    {uploading ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>

              {preview ? (
                <div className="prose max-w-none border border-gray-200 rounded-lg p-6">
                  <ReactMarkdown>{content}</ReactMarkdown>
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="w-full h-96 p-4 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="# Architecture Documentation

## System Architecture Overview
<!-- Describe the overall system architecture -->

## Technology Stack
<!-- List the technologies used -->

## Component Architecture
<!-- Describe the components and their relationships -->

## Data Flow
<!-- Describe how data flows through the system -->

## API Design
<!-- Document the API structure -->

## Database Schema
<!-- Document the database design -->

## Deployment Architecture
<!-- Describe the deployment setup -->

## Security Considerations
<!-- Document security measures -->"
                />
              )}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-500 mb-4">No architecture documentation yet</p>
              <div className="flex justify-center space-x-4">
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
                >
                  {generating ? 'Generating...' : 'Generate with AI'}
                </button>
                <button
                  onClick={() => setShowUpload(true)}
                  className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition"
                >
                  Upload Manually
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ADRs Section */}
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-xl font-semibold">Architectural Decision Records (ADRs)</h2>
        </div>
        <div className="p-6">
          <p className="text-gray-500 text-sm">
            ADRs will be displayed here once they are created. You can generate them using AI or upload them manually.
          </p>
        </div>
      </div>
    </div>
  );
}
