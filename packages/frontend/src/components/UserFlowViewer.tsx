import { useEffect, useRef } from 'react';
import { UserFlow } from '@devflow-studio/shared';

interface UserFlowViewerProps {
  flow: UserFlow;
}

export default function UserFlowViewer({ flow }: UserFlowViewerProps) {
  const mermaidRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  useEffect(() => {
    if (!flow.flow_diagram || renderedRef.current) return;

    const renderMermaid = async () => {
      try {
        // Dynamically import mermaid
        const mermaid = (await import('mermaid')).default;
        
        // Initialize mermaid
        mermaid.initialize({
          startOnLoad: false,
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
          securityLevel: 'loose',
        });

        if (mermaidRef.current) {
          mermaidRef.current.innerHTML = '';
          
          // Create a div with the mermaid class
          const diagramDiv = document.createElement('div');
          diagramDiv.className = 'mermaid';
          diagramDiv.textContent = flow.flow_diagram || '';
          mermaidRef.current.appendChild(diagramDiv);

          // Render the diagram
          await mermaid.run({
            nodes: [diagramDiv],
            suppressErrors: false,
          });
          
          renderedRef.current = true;
        }
      } catch (error) {
        console.error('Failed to render Mermaid diagram:', error);
        if (mermaidRef.current) {
          mermaidRef.current.innerHTML = `
            <div class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-red-800 dark:text-red-200">
              <p class="font-semibold">Error rendering diagram</p>
              <p class="text-sm mt-1">${error instanceof Error ? error.message : 'Unknown error'}</p>
              <details class="mt-2">
                <summary class="cursor-pointer text-sm">Show diagram code</summary>
                <pre class="mt-2 text-xs overflow-auto p-2 bg-gray-100 dark:bg-gray-800 rounded">${flow.flow_diagram}</pre>
              </details>
            </div>
          `;
        }
      }
    };

    renderMermaid();

    // Reset on unmount
    return () => {
      renderedRef.current = false;
    };
  }, [flow.flow_diagram, flow.id]);

  if (!flow.flow_diagram) {
    return (
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-4 text-yellow-800 dark:text-yellow-200">
        <p>Diagram is still being generated. Please refresh in a moment.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-700/50">
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">{flow.flow_name}</h2>
        {flow.description && (
          <p className="text-gray-600 dark:text-gray-400 mb-2">{flow.description}</p>
        )}
        <p className="text-sm text-gray-500 dark:text-gray-500">
          Created: {new Date(flow.created_at).toLocaleString()}
        </p>
      </div>
      
      <div className="border border-gray-200 dark:border-gray-700 rounded p-4 bg-gray-50 dark:bg-gray-900/50 overflow-x-auto">
        <div ref={mermaidRef} className="mermaid-container flex justify-center"></div>
      </div>
    </div>
  );
}
