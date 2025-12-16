import { useEffect, useState, useRef } from 'react';
import { CodingSession } from '@devflow-studio/shared';
import { codingSessionsApi } from '../api/codingSessions';

interface CodingSessionViewerProps {
  session: CodingSession;
  onClose?: () => void;
}

export default function CodingSessionViewer({ session, onClose }: CodingSessionViewerProps) {
  const [output, setOutput] = useState(session.output || '');
  const [testsOutput, setTestsOutput] = useState((session as any).tests_output || '');
  const [currentFile, setCurrentFile] = useState(session.current_file || '');
  const [progress, setProgress] = useState(session.progress || 0);
  const [testProgress, setTestProgress] = useState((session as any).test_progress || 0);
  const [implementationProgress, setImplementationProgress] = useState((session as any).implementation_progress || 0);
  const [status, setStatus] = useState(session.status);
  const [isConnected, setIsConnected] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Connect to SSE stream
    const eventSource = codingSessionsApi.connectStream(
      session.id,
      (event) => {
        setIsConnected(true);

        if (event.type === 'connected') {
          console.log('Connected to coding session stream');
        } else if (event.type === 'output') {
          const currentStatus = status;
          if (currentStatus === 'generating_tests' || currentStatus === 'tests_generated') {
            setTestsOutput((prev) => prev + event.payload.output);
          } else {
            setOutput((prev) => prev + event.payload.output);
          }
        } else if (event.type === 'progress') {
          if (event.payload.progress !== undefined) {
            setProgress(event.payload.progress);
          }
          if (event.payload.test_progress !== undefined) {
            setTestProgress(event.payload.test_progress);
          }
          if (event.payload.implementation_progress !== undefined) {
            setImplementationProgress(event.payload.implementation_progress);
          }
          if (event.payload.current_file) {
            setCurrentFile(event.payload.current_file);
          }
        } else if (event.type === 'tests_generated') {
          setTestsOutput(event.payload.tests_output || '');
          setStatus('tests_generated');
          setTestProgress(50);
          setProgress(50);
        } else if (event.type === 'implementation_started') {
          setStatus('running');
        } else if (event.type === 'completed') {
          setStatus('completed');
          setProgress(100);
        } else if (event.type === 'error') {
          console.error('Coding session error:', event.payload.error);
        } else if (event.type === 'session_ended') {
          setStatus(event.payload.status);
          eventSource.close();
          setIsConnected(false);
        }
      },
      (error) => {
        console.error('SSE error:', error);
        setIsConnected(false);
      }
    );

    eventSourceRef.current = eventSource;

    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [session.id]);

  // Auto-scroll to bottom when output changes
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const getStatusColor = () => {
    switch (status) {
      case 'completed':
        return 'bg-green-500';
      case 'running':
        return 'bg-blue-500 animate-pulse';
      case 'generating_tests':
        return 'bg-yellow-500 animate-pulse';
      case 'tests_generated':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      case 'pending':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getProgrammerIcon = () => {
    switch (session.programmer_type) {
      case 'backend':
        return '🔧'; // Backend
      case 'frontend':
        return '🎨'; // Frontend
      case 'fullstack':
        return '⚡'; // Fullstack
      default:
        return '💻';
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-6xl h-5/6 flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 px-6 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <div className="text-3xl">{getProgrammerIcon()}</div>
            <div>
              <h2 className="text-xl font-semibold">
                {session.programmer_type.charAt(0).toUpperCase() + session.programmer_type.slice(1)} Developer
              </h2>
              <p className="text-sm text-gray-500">
                {isConnected ? (
                  <span className="text-green-600">● Connected</span>
                ) : (
                  <span className="text-gray-400">○ Disconnected</span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${getStatusColor()}`} />
              <span className="text-sm font-medium capitalize">{status}</span>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Progress Bars */}
        <div className="px-6 py-3 border-b border-gray-200 space-y-3">
          {/* Overall Progress */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">Overall Progress</span>
              <span className="text-sm font-medium text-gray-900">{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-blue-500 to-green-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          
          {/* Phase Progress */}
          {(status === 'generating_tests' || status === 'tests_generated' || status === 'running' || status === 'completed') && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-medium text-gray-600">Test Generation</span>
                  <span className="text-xs text-gray-500">{testProgress}/50%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${
                      testProgress === 50 ? 'bg-green-500' : 'bg-yellow-500'
                    }`}
                    style={{ width: `${(testProgress / 50) * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-medium text-gray-600">Implementation</span>
                  <span className="text-xs text-gray-500">{implementationProgress}/50%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${
                      implementationProgress === 50 ? 'bg-green-500' : status === 'running' ? 'bg-blue-500' : 'bg-gray-400'
                    }`}
                    style={{ width: `${(implementationProgress / 50) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          )}
          
          {/* Phase Indicator */}
          <div className="flex items-center space-x-2 text-xs">
            {status === 'generating_tests' && (
              <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded">🧪 Generating Tests...</span>
            )}
            {status === 'tests_generated' && (
              <span className="px-2 py-1 bg-green-100 text-green-800 rounded">✅ Tests Generated</span>
            )}
            {(status === 'running' || status === 'completed') && (
              <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">💻 Implementing...</span>
            )}
          </div>
          
          {currentFile && (
            <p className="text-xs text-gray-500">
              📄 Currently working on: <span className="font-mono">{currentFile}</span>
            </p>
          )}
        </div>

        {/* Output Display with Tabs */}
        <div className="flex-1 overflow-hidden flex flex-col p-6">
          <div className="flex justify-between items-center mb-3">
            <div className="flex space-x-2">
              {testsOutput && (
                <button
                  className={`px-3 py-1 text-xs rounded-lg transition ${
                    status === 'generating_tests' || status === 'tests_generated'
                      ? 'bg-yellow-100 text-yellow-800 font-medium'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  🧪 Tests
                </button>
              )}
              <button
                className={`px-3 py-1 text-xs rounded-lg transition ${
                  status === 'running' || status === 'completed'
                    ? 'bg-blue-100 text-blue-800 font-medium'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                💻 Implementation
              </button>
            </div>
            <button
              onClick={() => {
                if (outputRef.current) {
                  outputRef.current.scrollTop = outputRef.current.scrollHeight;
                }
              }}
              className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
            >
              Scroll to Bottom
            </button>
          </div>
          
          <div
            ref={outputRef}
            className="flex-1 bg-gray-900 text-green-400 rounded-lg p-4 overflow-y-auto font-mono text-sm"
            style={{ fontFamily: 'Menlo, Monaco, Consolas, monospace' }}
          >
            {/* Show tests output if available and in test phase */}
            {(status === 'generating_tests' || status === 'tests_generated') && testsOutput && (
              <div className="mb-4">
                <div className="text-yellow-400 mb-2">=== Generated Tests ===</div>
                <pre className="whitespace-pre-wrap break-words text-yellow-300">{testsOutput}</pre>
                <div className="text-yellow-400 mt-2">=== End Tests ===</div>
              </div>
            )}
            
            {/* Show implementation output */}
            {output ? (
              <div>
                {(status === 'running' || status === 'completed') && (
                  <div className="text-blue-400 mb-2">=== Implementation Output ===</div>
                )}
                <pre className="whitespace-pre-wrap break-words">{output}</pre>
              </div>
            ) : !testsOutput && (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <div className="text-4xl mb-2">⏳</div>
                  <p>Waiting for output...</p>
                </div>
              </div>
            )}
            
            {(status === 'generating_tests' || status === 'running') && (
              <div className="inline-block w-2 h-4 bg-green-400 animate-pulse ml-1" />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 bg-gray-50">
          <div className="flex justify-between items-center text-xs text-gray-500">
            <div>
              Session ID: <span className="font-mono">{session.id.slice(0, 8)}</span>
            </div>
            {session.started_at && (
              <div>
                Started: {new Date(session.started_at).toLocaleTimeString()}
              </div>
            )}
            {session.completed_at && (
              <div>
                Completed: {new Date(session.completed_at).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
