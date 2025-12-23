import { Prototype } from '@devflow-studio/shared';

interface PrototypeViewerProps {
  prototype: Prototype;
}

export default function PrototypeViewer({ prototype }: PrototypeViewerProps) {
  const analysis = prototype.analysis_result;

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-700/50">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {prototype.file_name}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-500">
          Uploaded: {new Date(prototype.uploaded_at).toLocaleString()}
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-700/50">
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">Prototype Image</h3>
        <div className="border border-gray-200 dark:border-gray-700 rounded overflow-hidden bg-gray-50 dark:bg-gray-900/50">
          <img
            src={`/api/design/prototypes/${prototype.id}/image`}
            alt={prototype.file_name}
            className="w-full h-auto"
            onError={() => {
              console.error('Failed to load image:', prototype.file_path);
            }}
          />
        </div>
      </div>

      {analysis ? (
        <div className="space-y-6">
          {analysis.elements && analysis.elements.length > 0 && (
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-700/50">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                UI Elements ({analysis.elements.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {analysis.elements.map((element, index) => (
                  <div
                    key={index}
                    className="border border-gray-200 dark:border-gray-700 rounded p-3 bg-gray-50 dark:bg-gray-900/50"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <span className="inline-block px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded text-xs font-medium mb-1">
                          {element.type}
                        </span>
                        {element.label && (
                          <p className="text-gray-900 dark:text-white mt-1">{element.label}</p>
                        )}
                      </div>
                      {element.position && (
                        <span className="text-xs text-gray-500 dark:text-gray-500 ml-2">
                          ({element.position.x}, {element.position.y})
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {analysis.flows && analysis.flows.length > 0 && (
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-700/50">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                User Flows ({analysis.flows.length})
              </h3>
              <div className="space-y-3">
                {analysis.flows.map((flow, index) => (
                  <div
                    key={index}
                    className="border-l-4 border-blue-500 dark:border-blue-400 pl-4 py-2 bg-gray-50 dark:bg-gray-900/50 rounded-r"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-900 dark:text-white">{flow.from}</span>
                      <span className="text-gray-500 dark:text-gray-400">→</span>
                      <span className="font-medium text-gray-900 dark:text-white">{flow.to}</span>
                    </div>
                    {flow.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400">{flow.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {analysis.insights && analysis.insights.length > 0 && (
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow dark:shadow-gray-700/50">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                Insights ({analysis.insights.length})
              </h3>
              <ul className="space-y-2">
                {analysis.insights.map((insight, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2 text-gray-700 dark:text-gray-300"
                  >
                    <span className="text-blue-500 dark:text-blue-400 mt-1">•</span>
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded p-4 text-yellow-800 dark:text-yellow-200">
          <p>Analysis is still in progress. Please refresh in a moment.</p>
        </div>
      )}
    </div>
  );
}
