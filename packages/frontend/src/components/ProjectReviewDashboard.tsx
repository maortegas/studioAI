import { useEffect, useState, useRef } from 'react';
import { useToast } from '../context/ToastContext';
import * as reviewApi from '../api/review';
import FileEditorModal from './FileEditorModal';

interface ProjectReviewDashboardProps {
  projectId: string;
}

interface ActionableItem {
  id: string;
  error_message: string;
  category: 'dependency' | 'syntax' | 'type' | 'test' | 'build' | 'other';
  priority: 'high' | 'medium' | 'low';
  file_path?: string;
  line_number?: number;
  error_type?: string;
  suggested_fix?: string;
  status: 'pending' | 'fixing' | 'fixed' | 'skipped';
}

interface ReviewStatus {
  status: 'idle' | 'running' | 'errors_detected' | 'completed' | 'failed';
  current_step?: string;
  progress?: number;
  build_status?: 'pending' | 'running' | 'success' | 'failed';
  test_status?: 'pending' | 'running' | 'success' | 'failed';
  errors?: string[];
  warnings?: string[];
  iterations?: number;
  output?: string;
  actionable_items?: ActionableItem[];
  install_output?: string;
  build_output?: string;
  test_output?: string;
}

export default function ProjectReviewDashboard({ projectId }: ProjectReviewDashboardProps) {
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>({ status: 'idle' });
  const [isStarting, setIsStarting] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [selectedErrors, setSelectedErrors] = useState<Set<string>>(new Set());
  const [output, setOutput] = useState<string>('');
  const outputRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();
  const eventSourceRef = useRef<EventSource | null>(null);
  const [editingFile, setEditingFile] = useState<{ path: string; lineNumber?: number } | null>(null);

  useEffect(() => {
    loadReviewStatus();
  }, [projectId]);

  useEffect(() => {
    // Poll for updates when review is running or errors detected
    let pollInterval: NodeJS.Timeout | null = null;
    if (reviewStatus.status === 'running' || reviewStatus.status === 'errors_detected') {
      pollInterval = setInterval(() => {
        loadReviewStatus();
      }, 2000); // Poll every 2 seconds
    }
    
    // Cleanup on unmount or status change
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [projectId, reviewStatus.status]);

  const loadReviewStatus = async () => {
    try {
      const status = await reviewApi.getReviewStatus(projectId);
      const prevStatus = reviewStatus.status;
      
      console.log('[ProjectReviewDashboard] Loaded status:', status);
      console.log('[ProjectReviewDashboard] Status:', status.status);
      console.log('[ProjectReviewDashboard] Actionable items:', status.actionable_items?.length || 0);
      
      // Update output if available
      if (status.output) {
        setOutput(status.output);
      }
      
      setReviewStatus(status);
      
      // If status changed to completed or failed, show toast
      if (status.status === 'completed' && (prevStatus === 'running' || prevStatus === 'errors_detected')) {
        showToast('Review completed successfully!', 'success');
      } else if (status.status === 'failed' && (prevStatus === 'running' || prevStatus === 'errors_detected')) {
        showToast('Review failed', 'error');
      } else if (status.status === 'errors_detected' && prevStatus === 'running') {
        showToast(`${status.actionable_items?.length || 0} error(s) detected. Please review and select items to fix.`, 'info');
      }
    } catch (error) {
      console.error('Failed to load review status:', error);
    }
  };

  const handleStartReview = async () => {
    const confirmMessage = reviewStatus.status === 'errors_detected' 
      ? 'Restart project review? This will clear previous results and start a new review.'
      : 'Start full project review? This will execute the entire project, detect errors, and fix them automatically.';
    
    if (!confirm(confirmMessage)) {
      return;
    }

    setIsStarting(true);
    try {
      const result = await reviewApi.startProjectReview(projectId);
      showToast('Review process started', 'success');
      setOutput('');
      setSelectedErrors(new Set()); // Clear selected errors
      setReviewStatus({ status: 'running', progress: 0 });
      // Status will be updated via polling
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to start review', 'error');
    } finally {
      setIsStarting(false);
    }
  };

  const handleStopReview = async () => {
    try {
      await reviewApi.stopReview(projectId);
      showToast('Review stopped', 'success');
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      await loadReviewStatus();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to stop review', 'error');
    }
  };

  const handleToggleError = (errorId: string) => {
    setSelectedErrors(prev => {
      const newSet = new Set(prev);
      if (newSet.has(errorId)) {
        newSet.delete(errorId);
      } else {
        newSet.add(errorId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (reviewStatus.actionable_items) {
      const allIds = reviewStatus.actionable_items
        .filter(item => item.status === 'pending')
        .map(item => item.id);
      setSelectedErrors(new Set(allIds));
    }
  };

  const handleDeselectAll = () => {
    setSelectedErrors(new Set());
  };

  const handleFixSelected = async () => {
    if (selectedErrors.size === 0) {
      showToast('Please select at least one error to fix', 'warning');
      return;
    }

    setIsFixing(true);
    try {
      await reviewApi.fixSelectedErrors(projectId, Array.from(selectedErrors));
      showToast(`Fixing ${selectedErrors.size} error(s)...`, 'success');
      setSelectedErrors(new Set());
      await loadReviewStatus();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to fix errors', 'error');
    } finally {
      setIsFixing(false);
    }
  };

  const handleViewFile = async (filePath: string, lineNumber?: number) => {
    try {
      const fileContent = await reviewApi.getFileContent(projectId, filePath);
      
      // Escape HTML function
      const escapeHtml = (text: string) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      };
      
      // Open file content in a modal or new window
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        const lines = fileContent.content.split('\n');
        const htmlContent = lines.map((line: string, idx: number) => {
          const lineNum = idx + 1;
          const isHighlight = lineNumber && lineNum === lineNumber;
          return `<div class="line ${isHighlight ? 'highlight' : ''}"><span class="line-number">${lineNum}</span><span>${escapeHtml(line)}</span></div>`;
        }).join('');
        
        newWindow.document.write(`
          <html>
            <head>
              <title>${escapeHtml(filePath)}</title>
              <style>
                body { 
                  font-family: 'Monaco', 'Courier New', monospace; 
                  padding: 20px; 
                  background: #1e1e1e; 
                  color: #d4d4d4;
                  line-height: 1.6;
                }
                pre { margin: 0; }
                .line-number { 
                  color: #858585; 
                  margin-right: 20px; 
                  user-select: none;
                  display: inline-block;
                  width: 60px;
                  text-align: right;
                }
                .line { 
                  display: flex; 
                  padding: 2px 0;
                }
                .line.highlight { 
                  background: #264f78; 
                }
                code { 
                  white-space: pre-wrap; 
                  word-wrap: break-word;
                }
              </style>
            </head>
            <body>
              <h2 style="color: #4ec9b0; margin-bottom: 20px;">${escapeHtml(filePath)}${lineNumber ? ` (Line ${lineNumber})` : ''}</h2>
              <pre><code>${htmlContent}</code></pre>
            </body>
          </html>
        `);
        newWindow.document.close();
      }
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to load file', 'error');
    }
  };

  const handleEditFile = async (filePath: string, lineNumber?: number) => {
    // Open modal editor instead of external editor
    setEditingFile({ path: filePath, lineNumber });
  };

  const handleSaveFile = async (content: string) => {
    if (!editingFile) return;
    await reviewApi.saveFileContent(projectId, editingFile.path, content);
    // Reload review status to reflect changes
    await loadReviewStatus();
  };

  const handleRunSingleError = async (errorId: string, category: string) => {
    try {
      await reviewApi.runSingleError(projectId, errorId, category);
      showToast('Running command for this error...', 'success');
      await loadReviewStatus();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to run command', 'error');
    }
  };

  return (
    <>
      {/* File Editor Modal */}
      {editingFile && (
        <FileEditorModal
          projectId={projectId}
          filePath={editingFile.path}
          lineNumber={editingFile.lineNumber}
          onClose={() => setEditingFile(null)}
          onSave={handleSaveFile}
        />
      )}

      <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Project Review</h2>
            <p className="text-gray-600 dark:text-gray-400">
              Execute the entire project, detect errors, and fix them automatically
            </p>
          </div>
          <div className="flex space-x-2">
            {(reviewStatus.status === 'idle' || reviewStatus.status === 'completed' || reviewStatus.status === 'failed') && (
              <button
                onClick={handleStartReview}
                disabled={isStarting}
                className="px-6 py-2 bg-green-600 dark:bg-green-500 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isStarting ? 'Starting...' : '🚀 Start Review'}
              </button>
            )}
            {reviewStatus.status === 'running' && (
              <button
                onClick={handleStopReview}
                className="px-6 py-2 bg-red-600 dark:bg-red-500 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-600 transition"
              >
                ⏹️ Stop Review
              </button>
            )}
            {reviewStatus.status === 'errors_detected' && (
              <div className="flex space-x-2">
                <button
                  onClick={handleStartReview}
                  disabled={isStarting}
                  className="px-6 py-2 bg-gray-600 dark:bg-gray-500 text-white rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isStarting ? 'Starting...' : '🔄 Restart Review'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Status Overview */}
      {reviewStatus.status !== 'idle' && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
          <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Review Status</h3>
          
          <div className="space-y-4">
            {/* Overall Status */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Status</span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                reviewStatus.status === 'running' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                reviewStatus.status === 'completed' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                reviewStatus.status === 'failed' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
              }`}>
                {reviewStatus.status}
              </span>
            </div>

            {/* Progress */}
            {reviewStatus.progress !== undefined && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Progress</span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">{reviewStatus.progress}%</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                  <div
                    className="bg-blue-600 dark:bg-blue-500 h-3 rounded-full transition-all duration-300"
                    style={{ width: `${reviewStatus.progress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Current Step */}
            {reviewStatus.current_step && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Current Step</span>
                <span className="text-sm text-gray-600 dark:text-gray-400">{reviewStatus.current_step}</span>
              </div>
            )}

            {/* Iterations */}
            {reviewStatus.iterations !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Iterations</span>
                <span className="text-sm text-gray-600 dark:text-gray-400">{reviewStatus.iterations}</span>
              </div>
            )}

            {/* Build Status */}
            {reviewStatus.build_status && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Build</span>
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  reviewStatus.build_status === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                  reviewStatus.build_status === 'failed' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                  reviewStatus.build_status === 'running' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                  'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                }`}>
                  {reviewStatus.build_status}
                </span>
              </div>
            )}

            {/* Test Status */}
            {reviewStatus.test_status && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Tests</span>
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  reviewStatus.test_status === 'success' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                  reviewStatus.test_status === 'failed' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                  reviewStatus.test_status === 'running' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                  'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                }`}>
                  {reviewStatus.test_status}
                </span>
              </div>
            )}

            {/* Errors */}
            {reviewStatus.errors && reviewStatus.errors.length > 0 && (
              <div>
                <span className="text-sm font-medium text-red-700 dark:text-red-400 mb-2 block">
                  Errors ({reviewStatus.errors.length})
                </span>
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 max-h-40 overflow-y-auto">
                  {reviewStatus.errors.map((error, idx) => (
                    <div key={idx} className="text-xs text-red-800 dark:text-red-300 mb-1">
                      • {error}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Debug Info */}
      {process.env.NODE_ENV === 'development' && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4">
          <p className="text-xs text-yellow-800 dark:text-yellow-300">
            <strong>Debug:</strong> Status: {reviewStatus.status} | 
            Actionable Items: {reviewStatus.actionable_items?.length || 0} | 
            Selected: {selectedErrors.size}
          </p>
        </div>
      )}

      {/* Actionable Errors List */}
      {reviewStatus.status === 'errors_detected' && reviewStatus.actionable_items && reviewStatus.actionable_items.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50">
          <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Errors Detected ({reviewStatus.actionable_items.length})
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Select errors to fix. Only selected errors will be corrected.
                </p>
              </div>
              <div className="flex space-x-2">
                <button
                  onClick={handleSelectAll}
                  className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition text-gray-700 dark:text-gray-300"
                >
                  Select All
                </button>
                <button
                  onClick={handleDeselectAll}
                  className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition text-gray-700 dark:text-gray-300"
                >
                  Deselect All
                </button>
                <button
                  onClick={handleFixSelected}
                  disabled={selectedErrors.size === 0 || isFixing}
                  className="px-4 py-2 text-sm bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isFixing ? 'Fixing...' : `Fix Selected (${selectedErrors.size})`}
                </button>
              </div>
            </div>
          </div>
          <div className="p-6">
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {reviewStatus.actionable_items.map((item) => {
                const isSelected = selectedErrors.has(item.id);
                const isDisabled = item.status !== 'pending';
                
                return (
                  <div
                    key={item.id}
                    className={`border rounded-lg p-4 transition ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                    } ${isDisabled ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start space-x-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleError(item.id)}
                        disabled={isDisabled}
                        className="mt-1 h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-2">
                          <span className={`px-2 py-1 text-xs font-medium rounded ${
                            item.priority === 'high' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                            item.priority === 'medium' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                            'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                          }`}>
                            {item.priority}
                          </span>
                          <span className={`px-2 py-1 text-xs font-medium rounded ${
                            item.category === 'syntax' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' :
                            item.category === 'type' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                            item.category === 'dependency' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' :
                            item.category === 'test' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                            item.category === 'build' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                            'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                          }`}>
                            {item.category}
                          </span>
                          {item.status === 'fixing' && (
                            <span className="px-2 py-1 text-xs font-medium rounded bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                              Fixing...
                            </span>
                          )}
                          {item.status === 'fixed' && (
                            <span className="px-2 py-1 text-xs font-medium rounded bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                              ✓ Fixed
                            </span>
                          )}
                        </div>
                        {item.file_path && (
                          <p className="text-sm font-semibold text-blue-700 dark:text-blue-400 mb-1">
                            📄 {item.file_path}
                            {item.line_number && ` (Line ${item.line_number})`}
                          </p>
                        )}
                        <p className="text-sm text-gray-900 dark:text-white font-mono mb-1">
                          {item.error_message}
                        </p>
                        <div className="flex space-x-2 mt-2">
                          {item.file_path && (
                            <>
                              <button
                                onClick={() => handleViewFile(item.file_path!, item.line_number)}
                                className="px-3 py-1 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition text-gray-700 dark:text-gray-300"
                                title="View file content"
                              >
                                👁️ View File
                              </button>
                              <button
                                onClick={() => handleEditFile(item.file_path!, item.line_number)}
                                className="px-3 py-1 text-xs bg-blue-100 dark:bg-blue-900/30 hover:bg-blue-200 dark:hover:bg-blue-900/50 rounded transition text-blue-700 dark:text-blue-300"
                                title="Open file in editor"
                              >
                                ✏️ Edit File
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => handleRunSingleError(item.id, item.category)}
                            disabled={item.status === 'fixing'}
                            className="px-3 py-1 text-xs bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-900/50 rounded transition text-green-700 dark:text-green-300 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="Run only this error's command"
                          >
                            ▶️ Run This
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Output Monitor */}
      {reviewStatus.status === 'running' && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50">
          <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Live Output</h3>
            <button
              onClick={() => {
                if (outputRef.current) {
                  outputRef.current.scrollTop = outputRef.current.scrollHeight;
                }
              }}
              className="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition text-gray-700 dark:text-gray-300"
            >
              Scroll to Bottom
            </button>
          </div>
          <div
            ref={outputRef}
            className="p-4 bg-gray-900 text-green-400 font-mono text-xs overflow-y-auto max-h-96"
            style={{ fontFamily: 'monospace' }}
          >
            {(reviewStatus.output || output) ? (
              <pre className="whitespace-pre-wrap">{reviewStatus.output || output}</pre>
            ) : (
              <span className="text-gray-500">Waiting for output...</span>
            )}
          </div>
        </div>
      )}

      {/* Completed Summary */}
      {reviewStatus.status === 'completed' && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
          <div className="flex items-center space-x-2 mb-2">
            <span className="text-2xl">✅</span>
            <h3 className="text-lg font-semibold text-green-800 dark:text-green-400">
              Review Completed Successfully!
            </h3>
          </div>
          <p className="text-sm text-green-700 dark:text-green-300">
            All errors have been fixed. The project is ready for deployment.
          </p>
          {reviewStatus.iterations && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-2">
              Completed in {reviewStatus.iterations} iteration(s)
            </p>
          )}
        </div>
      )}

      {/* Failed Summary */}
      {reviewStatus.status === 'failed' && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-6">
          <div className="flex items-center space-x-2 mb-2">
            <span className="text-2xl">❌</span>
            <h3 className="text-lg font-semibold text-red-800 dark:text-red-400">
              Review Failed
            </h3>
          </div>
          <p className="text-sm text-red-700 dark:text-red-300">
            The review process encountered errors that could not be automatically fixed.
          </p>
        </div>
      )}
      </div>
    </>
  );
}

