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
      <ADRManager projectId={projectId} />
    </div>
  );
}

// ADR Manager Component
function ADRManager({ projectId }: { projectId: string }) {
  const [adrs, setAdrs] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [decisionContext, setDecisionContext] = useState('');
  const [selectedADR, setSelectedADR] = useState<Artifact | null>(null);
  const [adrContent, setAdrContent] = useState('');
  const [preview, setPreview] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadADRs();
  }, [projectId]);

  // Listen for AI job completion
  useEffect(() => {
    if (currentJobId && generating) {
      const checkJobStatus = async () => {
        try {
          const { aiJobsApi } = await import('../api/aiJobs');
          const job = await aiJobsApi.getById(currentJobId);
          
          if (job.status === 'completed') {
            try {
              const result = await aiJobsApi.getResult(currentJobId);
              setAdrContent(result.output);
              setGenerating(false);
              setCurrentJobId(null);
              showToast('ADR generated! Review and save when ready.', 'success');
            } catch (error) {
              console.error('Failed to get job result:', error);
            }
          } else if (job.status === 'failed') {
            setGenerating(false);
            setCurrentJobId(null);
            showToast('ADR generation failed', 'error');
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
  }, [currentJobId, generating, showToast]);

  const loadADRs = async () => {
    try {
      const adrList = await artifactsApi.getADRs(projectId);
      setAdrs(adrList);
    } catch (error) {
      console.error('Failed to load ADRs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!decisionContext.trim()) {
      showToast('Please provide decision context', 'error');
      return;
    }

    setGenerating(true);
    try {
      const result = await artifactsApi.generateADR(projectId, decisionContext);
      setCurrentJobId(result.job_id);
      showToast('ADR generation started. This may take a few minutes...', 'info');
      setShowGenerate(false);
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to generate ADR', 'error');
      setGenerating(false);
      setCurrentJobId(null);
    }
  };

  const handleSaveADR = async () => {
    if (!adrContent.trim()) {
      showToast('ADR content cannot be empty', 'error');
      return;
    }

    setUploading(true);
    try {
      await artifactsApi.saveADR(projectId, adrContent);
      showToast('ADR saved successfully!', 'success');
      setAdrContent('');
      setShowGenerate(false);
      await loadADRs();
      window.dispatchEvent(new CustomEvent('artifactUpdated', { detail: { projectId } }));
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to save ADR', 'error');
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
      await artifactsApi.saveADR(projectId, fileContent);
      showToast('ADR uploaded successfully!', 'success');
      setFile(null);
      setShowUpload(false);
      await loadADRs();
      window.dispatchEvent(new CustomEvent('artifactUpdated', { detail: { projectId } }));
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to upload ADR', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleViewADR = async (adr: Artifact) => {
    try {
      const data = await artifactsApi.getContent(adr.id);
      setAdrContent(data.content);
      setSelectedADR(adr);
      setPreview(false);
    } catch (error) {
      showToast('Failed to load ADR content', 'error');
    }
  };

  const handleDeleteADR = async (adrId: string) => {
    if (!confirm('Are you sure you want to delete this ADR?')) {
      return;
    }

    try {
      await artifactsApi.deleteADR(adrId);
      showToast('ADR deleted successfully', 'success');
      await loadADRs();
      if (selectedADR?.id === adrId) {
        setSelectedADR(null);
        setAdrContent('');
      }
      window.dispatchEvent(new CustomEvent('artifactUpdated', { detail: { projectId } }));
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to delete ADR', 'error');
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-xl font-semibold">Architectural Decision Records (ADRs)</h2>
        </div>
        <div className="p-6 text-center">Loading ADRs...</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="border-b border-gray-200 px-6 py-4 flex justify-between items-center">
        <h2 className="text-xl font-semibold">Architectural Decision Records (ADRs)</h2>
        <div className="flex space-x-2">
          <button
            onClick={() => {
              setShowUpload(!showUpload);
              setShowGenerate(false);
            }}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {showUpload ? 'Cancel Upload' : 'Upload ADR'}
          </button>
          <button
            onClick={() => {
              setShowGenerate(!showGenerate);
              setShowUpload(false);
            }}
            className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition"
          >
            Generate with AI
          </button>
        </div>
      </div>

      {/* Generate ADR Form */}
      {showGenerate && (
        <div className="p-6 border-b border-gray-200 bg-gray-50">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Decision Context (What decision needs to be made?)
              </label>
              <textarea
                value={decisionContext}
                onChange={(e) => setDecisionContext(e.target.value)}
                placeholder="Describe the architectural decision that needs to be made. For example: 'Should we use a microservices or monolithic architecture?' or 'Which database should we use for storing user sessions?'"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 h-24"
              />
            </div>
            <div className="flex space-x-2">
              <button
                onClick={handleGenerate}
                disabled={!decisionContext.trim() || generating}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
              >
                {generating ? 'Generating...' : 'Generate ADR'}
              </button>
              <button
                onClick={() => {
                  setShowGenerate(false);
                  setDecisionContext('');
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generated ADR Editor */}
      {adrContent && !selectedADR && (
        <div className="p-6 border-b border-gray-200 bg-blue-50">
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-medium">Review Generated ADR</h3>
              <div className="flex space-x-2">
                <button
                  onClick={() => setPreview(!preview)}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
                >
                  {preview ? 'Edit' : 'Preview'}
                </button>
                <button
                  onClick={handleSaveADR}
                  disabled={uploading}
                  className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {uploading ? 'Saving...' : 'Save ADR'}
                </button>
                <button
                  onClick={() => {
                    setAdrContent('');
                    setShowGenerate(true);
                  }}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
                >
                  Discard
                </button>
              </div>
            </div>
            {preview ? (
              <div className="prose max-w-none border border-gray-200 rounded-lg p-4 bg-white">
                <ReactMarkdown>{adrContent}</ReactMarkdown>
              </div>
            ) : (
              <textarea
                value={adrContent}
                onChange={(e) => setAdrContent(e.target.value)}
                className="w-full h-96 p-4 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            )}
          </div>
        </div>
      )}

      {/* Upload ADR Form */}
      {showUpload && (
        <div className="p-6 border-b border-gray-200 bg-gray-50">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Select ADR File (MD, TXT, etc.)
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
              {uploading ? 'Uploading...' : 'Upload ADR'}
            </button>
          </div>
        </div>
      )}

      {/* ADRs List */}
      <div className="p-6">
        {adrs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">No ADRs yet</p>
            <p className="text-sm text-gray-400">
              Generate ADRs with AI or upload them manually to document architectural decisions.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {adrs.map((adr) => {
              const adrNum = (adr.content as any)?.adrNumber || '?';
              const pathParts = adr.path.split('/');
              const fileName = pathParts[pathParts.length - 1];
              
              return (
                <div
                  key={adr.id}
                  className={`border rounded-lg p-4 hover:bg-gray-50 transition ${
                    selectedADR?.id === adr.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-medium text-lg">
                        ADR-{adrNum.toString().padStart(3, '0')}: {fileName.replace('.md', '')}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">
                        Created: {new Date(adr.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleViewADR(adr)}
                        className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
                      >
                        {selectedADR?.id === adr.id ? 'Hide' : 'View'}
                      </button>
                      <button
                        onClick={() => handleDeleteADR(adr.id)}
                        className="px-3 py-1 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  
                  {selectedADR?.id === adr.id && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium">ADR Content</span>
                        <button
                          onClick={() => setPreview(!preview)}
                          className="px-2 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50"
                        >
                          {preview ? 'Edit' : 'Preview'}
                        </button>
                      </div>
                      {preview ? (
                        <div className="prose max-w-none border border-gray-200 rounded-lg p-4 bg-white">
                          <ReactMarkdown>{adrContent}</ReactMarkdown>
                        </div>
                      ) : (
                        <textarea
                          value={adrContent}
                          onChange={(e) => setAdrContent(e.target.value)}
                          className="w-full h-64 p-3 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      )}
                      <div className="mt-2 flex justify-end">
                        <button
                          onClick={async () => {
                            await artifactsApi.saveADR(projectId, adrContent, adrNum);
                            showToast('ADR updated successfully!', 'success');
                            await loadADRs();
                          }}
                          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                          Update ADR
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
