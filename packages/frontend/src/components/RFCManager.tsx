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
              setGenerating(false);
              setCurrentJobId(null);
              showToast('RFC generated successfully! Review and save when ready.', 'success');
              await loadRFCs();
              // Select the newly generated RFC if available
              const updatedRfcs = await rfcApi.getByProject(projectId);
              if (updatedRfcs.length > 0) {
                const newRfc = updatedRfcs[updatedRfcs.length - 1]; // Get the last one (most recent)
                setSelectedRfc(newRfc);
                setContent(newRfc.content);
              }
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
      {/* Header with Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50">
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">RFC Documents</h2>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-4 py-2 text-sm bg-purple-600 dark:bg-purple-500 text-white rounded-lg hover:bg-purple-700 dark:hover:bg-purple-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? 'Generating...' : 'Generate RFC'}
          </button>
        </div>

        {/* RFCs List */}
        <div className="p-6">
          {rfcs.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400 mb-4">No RFC documents yet</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
                Generate an RFC from your PRD and User Stories to define the technical design.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
                {rfcs.map((rfc) => (
                  <div
                    key={rfc.id}
                    onClick={() => handleSelectRfc(rfc)}
                  className={`border rounded-lg p-4 cursor-pointer transition bg-white dark:bg-gray-800/50 ${
                      selectedRfc?.id === rfc.id
                      ? 'border-purple-500 dark:border-purple-400 bg-purple-50 dark:bg-purple-900/30 shadow-md dark:shadow-purple-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/30 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg mb-1 text-gray-900 dark:text-white">{rfc.title}</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                          Created: {new Date(rfc.created_at).toLocaleString()}
                        </p>
                      </div>
                    <div className="flex items-center space-x-2 ml-4">
                      <span className={`px-2 py-1 text-xs rounded border ${
                        rfc.status === 'approved'
                          ? 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700'
                          : rfc.status === 'review'
                          ? 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700'
                          : rfc.status === 'implemented'
                          ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700'
                          : 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600'
                      }`}>
                        {rfc.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RFC Content Viewer */}
      {selectedRfc && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 border border-gray-200 dark:border-gray-700">
          <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 bg-white dark:bg-gray-800 rounded-t-lg">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{selectedRfc.title}</h2>
              <span className={`px-3 py-1 text-sm rounded border ${
                selectedRfc.status === 'approved'
                  ? 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700'
                  : selectedRfc.status === 'review'
                  ? 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-700'
                  : selectedRfc.status === 'implemented'
                  ? 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700'
                  : 'bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600'
              }`}>
                {selectedRfc.status}
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Created: {new Date(selectedRfc.created_at).toLocaleString()}
            </p>
          </div>
          <div className="p-6 bg-gray-50 dark:bg-gray-900/50 rounded-b-lg">
            <div 
              className="prose prose-sm sm:prose-base lg:prose-lg dark:prose-invert max-w-none"
              style={{
                '--tw-prose-body': 'rgb(55 65 81)',
                '--tw-prose-headings': 'rgb(17 24 39)',
                '--tw-prose-lead': 'rgb(75 85 99)',
                '--tw-prose-links': 'rgb(147 51 234)',
                '--tw-prose-bold': 'rgb(17 24 39)',
                '--tw-prose-counters': 'rgb(107 114 128)',
                '--tw-prose-bullets': 'rgb(209 213 219)',
                '--tw-prose-hr': 'rgb(229 231 235)',
                '--tw-prose-quotes': 'rgb(17 24 39)',
                '--tw-prose-quote-borders': 'rgb(229 231 235)',
                '--tw-prose-captions': 'rgb(107 114 128)',
                '--tw-prose-code': 'rgb(147 51 234)',
                '--tw-prose-pre-code': 'rgb(229 231 235)',
                '--tw-prose-pre-bg': 'rgb(17 24 39)',
                '--tw-prose-th-borders': 'rgb(209 213 219)',
                '--tw-prose-td-borders': 'rgb(229 231 235)',
              } as React.CSSProperties & Record<string, string>}
            >
              <style>{`
                .dark .prose {
                  --tw-prose-body: rgb(229 231 235);
                  --tw-prose-headings: rgb(243 244 246);
                  --tw-prose-lead: rgb(209 213 219);
                  --tw-prose-links: rgb(196 181 253);
                  --tw-prose-bold: rgb(243 244 246);
                  --tw-prose-counters: rgb(156 163 175);
                  --tw-prose-bullets: rgb(75 85 99);
                  --tw-prose-hr: rgb(55 65 81);
                  --tw-prose-quotes: rgb(243 244 246);
                  --tw-prose-quote-borders: rgb(55 65 81);
                  --tw-prose-captions: rgb(156 163 175);
                  --tw-prose-code: rgb(196 181 253);
                  --tw-prose-pre-code: rgb(243 244 246);
                  --tw-prose-pre-bg: rgb(3 7 18);
                  --tw-prose-th-borders: rgb(55 65 81);
                  --tw-prose-td-borders: rgb(55 65 81);
                }
                .prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 {
                  color: rgb(17 24 39);
                  font-weight: 700;
                }
                .dark .prose h1, .dark .prose h2, .dark .prose h3, .dark .prose h4, .dark .prose h5, .dark .prose h6 {
                  color: rgb(243 244 246);
                }
                .prose p {
                  color: rgb(55 65 81);
                }
                .dark .prose p {
                  color: rgb(229 231 235);
                }
                .prose code {
                  background-color: rgb(249 250 251);
                  color: rgb(147 51 234);
                  padding: 0.125rem 0.375rem;
                  border-radius: 0.25rem;
                  font-size: 0.875rem;
                }
                .dark .prose code {
                  background-color: rgb(31 41 55);
                  color: rgb(196 181 253);
                }
                .prose pre {
                  background-color: rgb(249 250 251);
                  color: rgb(17 24 39);
                  border: 1px solid rgb(229 231 235);
                  border-radius: 0.5rem;
                  padding: 1rem;
                  overflow-x: auto;
                }
                .dark .prose pre {
                  background-color: rgb(3 7 18);
                  color: rgb(243 244 246);
                  border-color: rgb(31 41 55);
                }
                .prose pre code {
                  background-color: transparent;
                  color: inherit;
                  padding: 0;
                }
                .prose a {
                  color: rgb(147 51 234);
                  text-decoration: none;
                }
                .dark .prose a {
                  color: rgb(196 181 253);
                }
                .prose a:hover {
                  color: rgb(126 34 206);
                  text-decoration: underline;
                }
                .dark .prose a:hover {
                  color: rgb(167 139 250);
                }
                .prose strong {
                  color: rgb(17 24 39);
                  font-weight: 600;
                }
                .dark .prose strong {
                  color: rgb(243 244 246);
                }
                .prose blockquote {
                  border-left: 4px solid rgb(147 51 234);
                  background-color: rgb(249 250 251);
                  padding: 0.5rem 1rem;
                  border-radius: 0 0.25rem 0.25rem 0;
                  color: rgb(75 85 99);
                }
                .dark .prose blockquote {
                  border-left-color: rgb(196 181 253);
                  background-color: rgb(31 41 55);
                  color: rgb(209 213 219);
                }
                .prose ul, .prose ol {
                  color: rgb(55 65 81);
                }
                .dark .prose ul, .dark .prose ol {
                  color: rgb(229 231 235);
                }
                .prose li {
                  color: rgb(55 65 81);
                }
                .dark .prose li {
                  color: rgb(229 231 235);
                }
                .prose table {
                  width: 100%;
                  border-collapse: collapse;
                }
                .prose thead {
                  border-bottom: 2px solid rgb(209 213 219);
                  background-color: rgb(249 250 251);
                }
                .dark .prose thead {
                  border-bottom-color: rgb(55 65 81);
                  background-color: rgb(31 41 55);
                }
                .prose th {
                  color: rgb(17 24 39);
                  font-weight: 600;
                  padding: 0.75rem;
                  text-align: left;
                }
                .dark .prose th {
                  color: rgb(243 244 246);
                }
                .prose td {
                  border-bottom: 1px solid rgb(229 231 235);
                  padding: 0.75rem;
                  color: rgb(55 65 81);
                }
                .dark .prose td {
                  border-bottom-color: rgb(55 65 81);
                  color: rgb(229 231 235);
                }
                .prose hr {
                  border-color: rgb(209 213 219);
                  margin: 2rem 0;
                }
                .dark .prose hr {
                  border-color: rgb(55 65 81);
                }
              `}</style>
              <ReactMarkdown
                components={{
                  // Personalizar renderizado de headers para destacar códigos
                  h1: ({ children, ...props }: any) => {
                    try {
                      const text = Array.isArray(children) ? children.join('') : String(children || '');
                      const codeMatch = text.match(/\[(RFC-SEC-\d+)\]/);
                      if (codeMatch) {
                        const code = codeMatch[1];
                        const headerText = text.replace(/\s*\[RFC-SEC-\d+\]\s*$/, '').trim();
                        return (
                          <h1 {...props} className="group relative">
                            {headerText}
                            <span className="ml-2 inline-flex items-center px-2 py-1 text-xs font-mono font-semibold rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              {code}
                            </span>
                          </h1>
                        );
                      }
                    } catch (e) {
                      // Fallback si hay error procesando
                    }
                    return <h1 {...props}>{children}</h1>;
                  },
                  h2: ({ children, ...props }: any) => {
                    try {
                      const text = Array.isArray(children) ? children.join('') : String(children || '');
                      const codeMatch = text.match(/\[(RFC-SEC-\d+)\]/);
                      if (codeMatch) {
                        const code = codeMatch[1];
                        const headerText = text.replace(/\s*\[RFC-SEC-\d+\]\s*$/, '').trim();
                        return (
                          <h2 {...props} className="group relative">
                            {headerText}
                            <span className="ml-2 inline-flex items-center px-2 py-1 text-xs font-mono font-semibold rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              {code}
                            </span>
                          </h2>
                        );
                      }
                    } catch (e) {
                      // Fallback si hay error procesando
                    }
                    return <h2 {...props}>{children}</h2>;
                  },
                  h3: ({ children, ...props }: any) => {
                    try {
                      const text = Array.isArray(children) ? children.join('') : String(children || '');
                      const codeMatch = text.match(/\[(RFC-SEC-\d+)\]/);
                      if (codeMatch) {
                        const code = codeMatch[1];
                        const headerText = text.replace(/\s*\[RFC-SEC-\d+\]\s*$/, '').trim();
                        return (
                          <h3 {...props} className="group relative">
                            {headerText}
                            <span className="ml-2 inline-flex items-center px-2 py-1 text-xs font-mono font-semibold rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              {code}
                            </span>
                          </h3>
                        );
                      }
                    } catch (e) {
                      // Fallback si hay error procesando
                    }
                    return <h3 {...props}>{children}</h3>;
                  },
                  h4: ({ children, ...props }: any) => {
                    try {
                      const text = Array.isArray(children) ? children.join('') : String(children || '');
                      const codeMatch = text.match(/\[(RFC-SEC-\d+)\]/);
                      if (codeMatch) {
                        const code = codeMatch[1];
                        const headerText = text.replace(/\s*\[RFC-SEC-\d+\]\s*$/, '').trim();
                        return (
                          <h4 {...props} className="group relative">
                            {headerText}
                            <span className="ml-2 inline-flex items-center px-2 py-1 text-xs font-mono font-semibold rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              {code}
                            </span>
                          </h4>
                        );
                      }
                    } catch (e) {
                      // Fallback si hay error procesando
                    }
                    return <h4 {...props}>{children}</h4>;
                  },
                  h5: ({ children, ...props }: any) => {
                    try {
                      const text = Array.isArray(children) ? children.join('') : String(children || '');
                      const codeMatch = text.match(/\[(RFC-SEC-\d+)\]/);
                      if (codeMatch) {
                        const code = codeMatch[1];
                        const headerText = text.replace(/\s*\[RFC-SEC-\d+\]\s*$/, '').trim();
                        return (
                          <h5 {...props} className="group relative">
                            {headerText}
                            <span className="ml-2 inline-flex items-center px-2 py-1 text-xs font-mono font-semibold rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              {code}
                            </span>
                          </h5>
                        );
                      }
                    } catch (e) {
                      // Fallback si hay error procesando
                    }
                    return <h5 {...props}>{children}</h5>;
                  },
                  h6: ({ children, ...props }: any) => {
                    try {
                      const text = Array.isArray(children) ? children.join('') : String(children || '');
                      const codeMatch = text.match(/\[(RFC-SEC-\d+)\]/);
                      if (codeMatch) {
                        const code = codeMatch[1];
                        const headerText = text.replace(/\s*\[RFC-SEC-\d+\]\s*$/, '').trim();
                        return (
                          <h6 {...props} className="group relative">
                            {headerText}
                            <span className="ml-2 inline-flex items-center px-2 py-1 text-xs font-mono font-semibold rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                              {code}
                            </span>
                          </h6>
                        );
                      }
                    } catch (e) {
                      // Fallback si hay error procesando
                    }
                    return <h6 {...props}>{children}</h6>;
                  },
                }}
              >
                {content}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
