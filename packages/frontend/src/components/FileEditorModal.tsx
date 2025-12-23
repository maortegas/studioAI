import { useState, useEffect, useRef } from 'react';
import { useToast } from '../context/ToastContext';
import * as reviewApi from '../api/review';

interface FileEditorModalProps {
  projectId: string;
  filePath: string;
  lineNumber?: number;
  onClose: () => void;
  onSave?: (content: string) => Promise<void>;
}

export default function FileEditorModal({
  projectId,
  filePath,
  lineNumber,
  onClose,
  onSave,
}: FileEditorModalProps) {
  const [content, setContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    loadFile();
  }, [projectId, filePath]);

  useEffect(() => {
    // Scroll to line number when content loads
    if (content && lineNumber && textareaRef.current) {
      scrollToLine(lineNumber);
    }
  }, [content, lineNumber]);

  useEffect(() => {
    // Sync scroll between textarea and line numbers
    const textarea = textareaRef.current;
    const lineNumbers = lineNumbersRef.current;
    
    if (textarea && lineNumbers) {
      const handleScroll = () => {
        lineNumbers.scrollTop = textarea.scrollTop;
      };
      textarea.addEventListener('scroll', handleScroll);
      return () => textarea.removeEventListener('scroll', handleScroll);
    }
  }, [content]);

  const loadFile = async () => {
    try {
      setLoading(true);
      const result = await reviewApi.getFileContent(projectId, filePath);
      setContent(result.content);
      setOriginalContent(result.content);
      setHasChanges(false);
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to load file', 'error');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const scrollToLine = (line: number) => {
    if (!textareaRef.current) return;
    
    const textarea = textareaRef.current;
    const lines = content.split('\n');
    const lineHeight = 20; // Approximate line height in pixels
    const targetScroll = (line - 1) * lineHeight;
    
    textarea.scrollTop = Math.max(0, targetScroll - 100); // Scroll with some padding
    
    // Highlight the line briefly
    setTimeout(() => {
      const start = content.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
      const end = start + lines[line - 1]?.length || 0;
      textarea.setSelectionRange(start, end);
      textarea.focus();
    }, 100);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    setHasChanges(newContent !== originalContent);
  };

  const handleSave = async () => {
    if (!hasChanges) {
      showToast('No changes to save', 'info');
      return;
    }

    setSaving(true);
    try {
      if (onSave) {
        await onSave(content);
      } else {
        // Default: save via API
        await reviewApi.saveFileContent(projectId, filePath, content);
      }
      setOriginalContent(content);
      setHasChanges(false);
      showToast('File saved successfully', 'success');
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to save file', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
    // Esc to close (if no changes)
    if (e.key === 'Escape' && !hasChanges) {
      onClose();
    }
  };

  const lines = content.split('\n');
  const lineCount = lines.length;

  // Determine language for syntax highlighting
  const getLanguage = () => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      js: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      java: 'java',
      go: 'go',
      rs: 'rust',
      html: 'html',
      css: 'css',
      json: 'json',
      md: 'markdown',
      yml: 'yaml',
      yaml: 'yaml',
    };
    return langMap[ext || ''] || 'text';
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6">
          <div className="text-gray-900 dark:text-white">Loading file...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center space-x-3">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              ✏️ Edit File
            </h2>
            <span className="text-sm text-gray-500 dark:text-gray-400 font-mono">
              {filePath}
              {lineNumber && ` (Line ${lineNumber})`}
            </span>
            {hasChanges && (
              <span className="px-2 py-1 text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 rounded">
                Unsaved changes
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {saving ? 'Saving...' : '💾 Save'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition text-sm"
            >
              {hasChanges ? 'Cancel' : 'Close'}
            </button>
          </div>
        </div>

        {/* Editor Container */}
        <div className="flex-1 overflow-hidden flex">
          {/* Line Numbers */}
          <div
            ref={lineNumbersRef}
            className="bg-gray-50 dark:bg-gray-900/50 border-r border-gray-200 dark:border-gray-700 px-3 py-2 text-right text-xs text-gray-500 dark:text-gray-400 font-mono overflow-y-auto"
            style={{ minWidth: '60px', maxHeight: '100%' }}
          >
            {lines.map((_, index) => (
              <div
                key={index}
                className={`h-5 leading-5 ${
                  lineNumber && index + 1 === lineNumber
                    ? 'bg-yellow-200 dark:bg-yellow-900/30 font-bold'
                    : ''
                }`}
              >
                {index + 1}
              </div>
            ))}
          </div>

          {/* Code Editor */}
          <div className="flex-1 relative overflow-hidden">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleContentChange}
              onKeyDown={handleKeyDown}
              className="w-full h-full p-4 font-mono text-sm bg-gray-900 text-green-400 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{
                lineHeight: '20px',
                tabSize: 2,
                fontFamily: "'Monaco', 'Courier New', monospace",
              }}
              spellCheck={false}
              placeholder="File content will appear here..."
            />
            
            {/* Syntax highlighting overlay (basic) */}
            {lineNumber && (
              <div
                className="absolute pointer-events-none"
                style={{
                  top: `${(lineNumber - 1) * 20}px`,
                  left: '16px',
                  right: '16px',
                  height: '20px',
                  backgroundColor: 'rgba(255, 255, 0, 0.1)',
                  borderLeft: '3px solid yellow',
                }}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
          <div className="flex items-center space-x-4">
            <span>Language: {getLanguage()}</span>
            <span>Lines: {lineCount}</span>
            <span>Characters: {content.length}</span>
          </div>
          <div className="flex items-center space-x-2">
            <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs">Ctrl/Cmd + S</kbd>
            <span>to save</span>
            {!hasChanges && (
              <>
                <span>•</span>
                <kbd className="px-2 py-1 bg-gray-200 dark:bg-gray-700 rounded text-xs">Esc</kbd>
                <span>to close</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

