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
    } catch (error) {
      console.error('Failed to save PRD:', error);
      alert('Failed to save PRD');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="border-b border-gray-200 px-6 py-4 flex justify-between items-center">
        <h2 className="text-xl font-semibold">Product Requirements Document (PRD)</h2>
        <div className="space-x-2">
          <button
            onClick={() => setPreview(!preview)}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {preview ? 'Edit' : 'Preview'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <div className="p-6">
        {preview ? (
          <div className="prose max-w-none">
            <ReactMarkdown>{content}</ReactMarkdown>
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-96 p-4 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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

