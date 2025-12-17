import { useEffect, useState } from 'react';
import { QADashboard as QADashboardType, QASession, QAReport, TestResult } from '@devflow-studio/shared';
import { qaApi } from '../api/qa';
import { useToast } from '../context/ToastContext';

interface QADashboardProps {
  projectId: string;
}

interface TestFile {
  name: string;
  path: string;
  size: number;
}

export default function QADashboard({ projectId }: QADashboardProps) {
  const [dashboard, setDashboard] = useState<QADashboardType | null>(null);
  const [selectedSession, setSelectedSession] = useState<QAReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingTests, setGeneratingTests] = useState(false);
  const [runningQA, setRunningQA] = useState<string | null>(null);
  const [testFiles, setTestFiles] = useState<TestFile[]>([]);
  const [editingTest, setEditingTest] = useState<{ sessionId: string; fileName: string; content: string } | null>(null);
  const [loadingTestFiles, setLoadingTestFiles] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    loadDashboard();
    
    // Poll for updates every 5 seconds
    const interval = setInterval(loadDashboard, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  const loadDashboard = async () => {
    try {
      const data = await qaApi.getDashboard(projectId);
      setDashboard(data);
    } catch (error) {
      console.error('Failed to load QA dashboard:', error);
      showToast('Failed to load QA dashboard', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleViewSession = async (sessionId: string) => {
    try {
      const report = await qaApi.getSession(sessionId);
      setSelectedSession(report);
      
      // Load test files for this session
      await loadTestFiles(sessionId);
    } catch (error) {
      console.error('Failed to load QA session:', error);
      showToast('Failed to load QA session', 'error');
    }
  };

  const loadTestFiles = async (sessionId: string) => {
    setLoadingTestFiles(true);
    try {
      const files = await qaApi.getTestFiles(sessionId);
      setTestFiles(files);
    } catch (error) {
      console.error('Failed to load test files:', error);
      setTestFiles([]);
    } finally {
      setLoadingTestFiles(false);
    }
  };

  const handleEditTest = async (sessionId: string, fileName: string) => {
    try {
      const response = await qaApi.getTestFileContent(sessionId, fileName);
      setEditingTest({ sessionId, fileName, content: response.content });
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to load test file', 'error');
    }
  };

  const handleSaveTest = async () => {
    if (!editingTest) return;

    try {
      await qaApi.updateTestFile(editingTest.sessionId, editingTest.fileName, editingTest.content);
      showToast('Test file updated successfully', 'success');
      setEditingTest(null);
      await loadTestFiles(editingTest.sessionId);
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to update test file', 'error');
    }
  };

  const handleDeleteTest = async (sessionId: string, fileName: string) => {
    if (!confirm(`Are you sure you want to delete ${fileName}?`)) {
      return;
    }

    try {
      await qaApi.deleteTestFile(sessionId, fileName);
      showToast('Test file deleted successfully', 'success');
      await loadTestFiles(sessionId);
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to delete test file', 'error');
    }
  };

  const handleGenerateTests = async () => {
    setGeneratingTests(true);
    try {
      const result = await qaApi.generateTests(projectId);
      showToast(result.message || 'Test generation started', 'success');
      await loadDashboard();
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || 'Failed to generate tests';
      const isRetryable = error.response?.data?.retryable;
      
      if (isRetryable) {
        showToast(
          `${errorMessage} The system will automatically retry. You can check back in a moment.`,
          'warning',
          8000
        );
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setGeneratingTests(false);
    }
  };

  const handleRunQA = async (sessionId: string) => {
    setRunningQA(sessionId);
    try {
      const result = await qaApi.runQA(sessionId);
      showToast(result.message || 'QA session started', 'success');
      await loadDashboard();
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || 'Failed to run QA';
      const isRetryable = error.response?.data?.retryable;
      
      if (isRetryable) {
        showToast(
          `${errorMessage} The system will automatically retry. You can check back in a moment.`,
          'warning',
          8000
        );
      } else {
        showToast(errorMessage, 'error');
      }
    } finally {
      setRunningQA(null);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300';
      case 'running':
        return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300';
      case 'failed':
        return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300';
      default:
        return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300';
    }
  };

  const getTestStatusIcon = (status: string) => {
    switch (status) {
      case 'passed':
        return '✅';
      case 'failed':
        return '❌';
      case 'skipped':
        return '⏭️';
      case 'error':
        return '⚠️';
      default:
        return '❓';
    }
  };

  const getTestTypeColor = (type: string) => {
    switch (type) {
      case 'unit':
        return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300';
      case 'integration':
        return 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300';
      case 'e2e':
        return 'bg-pink-100 dark:bg-pink-900/30 text-pink-800 dark:text-pink-300';
      case 'performance':
        return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300';
      case 'security':
        return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300';
      default:
        return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300';
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-900 dark:text-white">Loading QA dashboard...</div>;
  }

  if (!dashboard) {
    return <div className="text-center py-8 text-gray-900 dark:text-white">No QA data available</div>;
  }

  const passRate = dashboard.total_sessions > 0
    ? Math.round((dashboard.passed_sessions / dashboard.total_sessions) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Manual Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50">
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">QA Actions</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Generate tests or run QA manually (QA also runs automatically after coding sessions)
          </p>
        </div>
        <div className="p-6">
          <div className="flex space-x-4">
            <button
              onClick={handleGenerateTests}
              disabled={generatingTests}
              className="flex items-center space-x-2 px-6 py-3 bg-yellow-600 dark:bg-yellow-500 text-white rounded-lg hover:bg-yellow-700 dark:hover:bg-yellow-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>{generatingTests ? 'Generating Tests...' : 'Generate Tests'}</span>
            </button>
            <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center">
              <span>💡 Tests are automatically generated during coding sessions</span>
            </div>
          </div>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4 border-t-4 border-blue-500">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{dashboard.total_sessions}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Total Sessions</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4 border-t-4 border-green-500">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{dashboard.passed_sessions}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Passed</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4 border-t-4 border-red-500">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{dashboard.failed_sessions}</div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Failed</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-4 border-t-4 border-purple-500">
          <div className="text-2xl font-bold text-gray-900 dark:text-white">
            {dashboard.average_coverage ? `${Math.round(dashboard.average_coverage)}%` : 'N/A'}
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">Avg Coverage</div>
        </div>
      </div>

      {/* Pass Rate */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Overall Pass Rate</h3>
          <span className="text-2xl font-bold text-gray-900 dark:text-white">{passRate}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-4">
          <div
            className={`h-4 rounded-full transition-all duration-500 ${
              passRate >= 80 ? 'bg-green-500' : passRate >= 50 ? 'bg-yellow-500' : 'bg-red-500'
            }`}
            style={{ width: `${passRate}%` }}
          />
        </div>
      </div>

      {/* Recent Sessions */}
      {dashboard.recent_sessions.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50">
          <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Recent QA Sessions</h2>
          </div>
          <div className="p-6">
            <div className="space-y-3">
              {dashboard.recent_sessions.map((session) => {
                const successRate = session.total_tests > 0
                  ? Math.round((session.passed_tests / session.total_tests) * 100)
                  : 0;

                return (
                  <div
                    key={session.id}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md dark:hover:shadow-gray-700/50 transition cursor-pointer bg-white dark:bg-gray-800"
                    onClick={() => handleViewSession(session.id)}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center space-x-2">
                            <span className={`px-2 py-1 text-xs rounded-full font-medium ${getStatusColor(session.status)}`}>
                              {session.status}
                            </span>
                            {session.coding_session_id && (
                              <span className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-full">
                                Auto-triggered
                              </span>
                            )}
                          </div>
                          {session.status === 'pending' && (
                            <button
                              onClick={() => handleRunQA(session.id)}
                              disabled={runningQA === session.id}
                              className="px-3 py-1 text-xs bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition disabled:opacity-50"
                            >
                              {runningQA === session.id ? 'Starting...' : 'Run QA'}
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-gray-500 dark:text-gray-400">Total:</span>
                            <span className="ml-2 font-semibold text-gray-900 dark:text-white">{session.total_tests}</span>
                          </div>
                          <div>
                            <span className="text-green-600 dark:text-green-400">Passed:</span>
                            <span className="ml-2 font-semibold text-gray-900 dark:text-white">{session.passed_tests}</span>
                          </div>
                          <div>
                            <span className="text-red-600 dark:text-red-400">Failed:</span>
                            <span className="ml-2 font-semibold text-gray-900 dark:text-white">{session.failed_tests}</span>
                          </div>
                          <div>
                            <span className="text-gray-500 dark:text-gray-400">Skipped:</span>
                            <span className="ml-2 font-semibold text-gray-900 dark:text-white">{session.skipped_tests}</span>
                          </div>
                        </div>
                        {session.coverage_percentage && (
                          <div className="mt-2 text-sm">
                            <span className="text-gray-500 dark:text-gray-400">Coverage:</span>
                            <span className="ml-2 font-semibold text-gray-900 dark:text-white">{Math.round(session.coverage_percentage)}%</span>
                          </div>
                        )}
                      </div>
                      <div className="text-right ml-4">
                        <div className="text-2xl font-bold text-gray-900 dark:text-white">{successRate}%</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">pass rate</div>
                        {session.completed_at && (
                          <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                            {new Date(session.completed_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            successRate >= 80 ? 'bg-green-500' : successRate >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${successRate}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Session Detail Modal */}
      {selectedSession && (
        <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center sticky top-0 bg-white dark:bg-gray-800">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">QA Session Details</h2>
              <button
                onClick={() => setSelectedSession(null)}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6">
              {/* Test Files Section */}
              {selectedSession && (
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Test Files</h3>
                    <button
                      onClick={() => selectedSession && loadTestFiles(selectedSession.id)}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Refresh
                    </button>
                  </div>
                  {loadingTestFiles ? (
                    <div className="text-center py-4 text-gray-900 dark:text-white">Loading test files...</div>
                  ) : testFiles.length === 0 ? (
                    <div className="text-center py-4 text-gray-500 dark:text-gray-400">No test files found</div>
                  ) : (
                    <div className="space-y-2">
                      {testFiles.map((file) => (
                        <div
                          key={file.name}
                          className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 bg-white dark:bg-gray-800"
                        >
                          <div className="flex-1">
                            <div className="font-medium text-gray-900 dark:text-white">{file.name}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400">
                              {(file.size / 1024).toFixed(2)} KB
                            </div>
                          </div>
                          <div className="flex space-x-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                selectedSession && handleEditTest(selectedSession.id, file.name);
                              }}
                              className="px-3 py-1 text-sm bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition"
                            >
                              Edit
                            </button>
                            {file.name !== 'all_tests.js' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectedSession && handleDeleteTest(selectedSession.id, file.name);
                                }}
                                className="px-3 py-1 text-sm bg-red-600 dark:bg-red-500 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-600 transition"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Summary */}
              <div className="grid grid-cols-5 gap-4 mb-6">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-blue-900 dark:text-blue-300">{selectedSession.summary.total}</div>
                  <div className="text-sm text-blue-700 dark:text-blue-400">Total Tests</div>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-green-900 dark:text-green-300">{selectedSession.summary.passed}</div>
                  <div className="text-sm text-green-700 dark:text-green-400">Passed</div>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-red-900 dark:text-red-300">{selectedSession.summary.failed}</div>
                  <div className="text-sm text-red-700 dark:text-red-400">Failed</div>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-yellow-900 dark:text-yellow-300">{selectedSession.summary.skipped}</div>
                  <div className="text-sm text-yellow-700 dark:text-yellow-400">Skipped</div>
                </div>
                {selectedSession.summary.coverage && (
                  <div className="bg-purple-50 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-purple-900">
                      {Math.round(selectedSession.summary.coverage)}%
                    </div>
                    <div className="text-sm text-purple-700">Coverage</div>
                  </div>
                )}
              </div>

              {/* Test Results */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Test Results</h3>
                <div className="space-y-2">
                  {selectedSession.test_results.map((test) => (
                    <div
                      key={test.id}
                      className={`border rounded-lg p-4 ${
                        test.status === 'passed' ? 'border-green-200 bg-green-50' :
                        test.status === 'failed' ? 'border-red-200 bg-red-50' :
                        'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            <span className="text-xl">{getTestStatusIcon(test.status)}</span>
                            <span className="font-semibold">{test.test_name}</span>
                            <span className={`px-2 py-0.5 text-xs rounded-full ${getTestTypeColor(test.test_type)}`}>
                              {test.test_type}
                            </span>
                          </div>
                          {test.error_message && (
                            <div className="mt-2 text-sm text-red-700">
                              <strong>Error:</strong> {test.error_message}
                            </div>
                          )}
                          {test.duration && (
                            <div className="text-xs text-gray-500 mt-1">
                              Duration: {test.duration}ms
                            </div>
                          )}
                        </div>
                        <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                          test.status === 'passed' ? 'bg-green-200 text-green-800' :
                          test.status === 'failed' ? 'bg-red-200 text-red-800' :
                          'bg-gray-200 text-gray-800'
                        }`}>
                          {test.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recommendations */}
              {(selectedSession as any).recommendations && (selectedSession as any).recommendations.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-semibold mb-4">Recommendations</h3>
                  <ul className="space-y-2">
                    {(selectedSession as any).recommendations.map((rec: string, index: number) => (
                      <li key={index} className="flex items-start space-x-2">
                        <span className="text-blue-500 mt-1">💡</span>
                        <span className="text-gray-700">{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Edit Test Modal */}
      {editingTest && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="border-b border-gray-200 px-6 py-4 flex justify-between items-center">
              <h2 className="text-xl font-semibold">Edit Test: {editingTest.fileName}</h2>
              <button
                onClick={() => setEditingTest(null)}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 p-6 overflow-y-auto">
              <textarea
                value={editingTest.content}
                onChange={(e) => setEditingTest({ ...editingTest, content: e.target.value })}
                className="w-full h-full font-mono text-sm border border-gray-300 rounded-lg p-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
                style={{ minHeight: '400px' }}
                spellCheck={false}
              />
            </div>
            <div className="border-t border-gray-200 px-6 py-4 flex justify-end space-x-3">
              <button
                onClick={() => setEditingTest(null)}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTest}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {dashboard.recent_sessions.length === 0 && (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="text-4xl mb-4">🧪</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No QA Sessions Yet</h3>
          <p className="text-gray-500">
            QA sessions are automatically created when coding sessions complete.
          </p>
        </div>
      )}
    </div>
  );
}
