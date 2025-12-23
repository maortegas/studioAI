import { useState, useEffect } from 'react';
import { artifactsApi } from '../api/artifacts';
import ReactMarkdown from 'react-markdown';

interface PRDEditorProps {
  projectId: string;
}

export default function PRDEditor({ projectId }: PRDEditorProps) {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    loadPRD();
  }, [projectId]);

  const loadPRD = async () => {
    try {
      const artifacts = await artifactsApi.getByProject(projectId);
      const prd = artifacts.find((a) => a.type === 'prd');
      if (prd) {
        const data = await artifactsApi.getContent(prd.id);
        setContent(data.content);
      }
    } catch (error) {
      console.error('Failed to load PRD:', error);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await artifactsApi.savePRD(projectId, content);
      // Emit event to notify other components
      window.dispatchEvent(new CustomEvent('artifactUpdated', { detail: { projectId } }));
    } catch (error) {
      console.error('Failed to save PRD:', error);
      alert('Failed to save PRD');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50">
      <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Product Requirements Document (PRD)</h2>
        <div className="space-x-2">
          <button
            onClick={() => setPreview(!preview)}
            className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
          >
            {preview ? 'Edit' : 'Preview'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="p-6">
        {preview ? (
          <div className="prose dark:prose-invert max-w-none prose-headings:text-gray-900 dark:prose-headings:text-white prose-p:text-gray-700 dark:prose-p:text-gray-300">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-96 p-4 border border-gray-300 dark:border-gray-600 rounded-lg font-mono text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            placeholder="# Product Requirements Document (PRD)

## Problem Statement
<!-- Describe the problem this project aims to solve -->

## Target Users
<!-- Who are the primary users of this product? -->

## Objectives
<!-- What are the main goals of this project? -->

## Constraints
<!-- What are the technical, business, or resource constraints? -->

## Non-Objectives
<!-- What is explicitly out of scope? -->"
          />
        )}
      </div>
    </div>
  );
}

