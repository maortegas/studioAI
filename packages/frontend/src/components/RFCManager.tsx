import { useState, useEffect } from 'react';
import { rfcApi } from '../api/rfc';
import { prdApi } from '../api/prd';
import { RFCDocument } from '@devflow-studio/shared';
import ReactMarkdown from 'react-markdown';
import { useToast } from '../context/ToastContext';

interface RFCManagerProps {
  projectId: string;
}

export default function RFCManager({ projectId }: RFCManagerProps) {
  const [rfcs, setRfcs] = useState<RFCDocument[]>([]);
  const [selectedRfc, setSelectedRfc] = useState<RFCDocument | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadRFCs();
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
              setContent(result.output);
              setGenerating(false);
              setCurrentJobId(null);
              showToast('RFC generated successfully! Review and save when ready.', 'success');
              await loadRFCs();
            } catch (error) {
              console.error('Failed to get job result:', error);
              setGenerating(false);
              setCurrentJobId(null);
              showToast('Failed to get RFC generation result', 'error');
            }
          } else if (job.status === 'failed') {
            setGenerating(false);
            setCurrentJobId(null);
            showToast('RFC generation failed', 'error');
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

  const loadRFCs = async () => {
    try {
      const data = await rfcApi.getByProject(projectId);
      setRfcs(data);
      if (data.length > 0 && !selectedRfc) {
        setSelectedRfc(data[0]);
        setContent(data[0].content);
      }
    } catch (error) {
      console.error('Failed to load RFCs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      // Get PRD for the project
      const prd = await prdApi.getByProject(projectId);
      if (!prd) {
        showToast('PRD is required to generate RFC. Please create a PRD first.', 'error');
        setGenerating(false);
        return;
      }

      const result = await rfcApi.generate({
        project_id: projectId,
        prd_id: prd.id,
      });
      setCurrentJobId(result.job_id);
      showToast('RFC generation started. This may take a few minutes...', 'info');
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to generate RFC', 'error');
      setGenerating(false);
      setCurrentJobId(null);
    }
  };

  const handleSelectRfc = (rfc: RFCDocument) => {
    setSelectedRfc(rfc);
    setContent(rfc.content);
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-900 dark:text-white">Loading RFCs...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50">
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">RFC Documents</h2>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 text-sm bg-purple-600 dark:bg-purple-500 text-white rounded-lg hover:bg-purple-700 dark:hover:bg-purple-600 transition disabled:opacity-50"
          >
            {generating ? 'Generating...' : 'Generate RFC'}
          </button>
        </div>

        <div className="p-6">
          {rfcs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-600 dark:text-gray-400 mb-4">No RFC documents yet.</p>
              <p className="text-sm text-gray-500 dark:text-gray-500">
                Generate an RFC from your PRD and User Stories to define the technical design.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* RFC List */}
              <div className="space-y-2">
                {rfcs.map((rfc) => (
                  <div
                    key={rfc.id}
                    onClick={() => handleSelectRfc(rfc)}
                    className={`p-4 border rounded-lg cursor-pointer transition ${
                      selectedRfc?.id === rfc.id
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold text-gray-900 dark:text-white">{rfc.title}</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                          Created: {new Date(rfc.created_at).toLocaleString()}
                        </p>
                      </div>
                      <span className={`px-2 py-1 text-xs rounded ${
                        rfc.status === 'approved' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                        rfc.status === 'review' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                        rfc.status === 'implemented' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                        'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                      }`}>
                        {rfc.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* RFC Content */}
              {selectedRfc && (
                <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-6">
                  <div className="prose dark:prose-invert max-w-none">
                    <ReactMarkdown>{content}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
