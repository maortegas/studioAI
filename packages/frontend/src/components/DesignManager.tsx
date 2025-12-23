import { useState } from 'react';
import ArchitectureManager from './ArchitectureManager';
import UserFlowsManager from './UserFlowsManager';
import PrototypesManager from './PrototypesManager';

interface DesignManagerProps {
  projectId: string;
}

export default function DesignManager({ projectId }: DesignManagerProps) {
  const [activeSection, setActiveSection] = useState<'architecture' | 'user-flows' | 'prototypes'>('architecture');

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="flex space-x-8">
          {[
            { id: 'architecture', label: 'Architecture' },
            { id: 'user-flows', label: 'User Flows' },
            { id: 'prototypes', label: 'Prototypes' },
          ].map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id as any)}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeSection === section.id
                  ? 'border-blue-500 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {section.label}
            </button>
          ))}
        </nav>
      </div>

      <div>
        {activeSection === 'architecture' && <ArchitectureManager projectId={projectId} />}
        {activeSection === 'user-flows' && <UserFlowsManager projectId={projectId} />}
        {activeSection === 'prototypes' && <PrototypesManager projectId={projectId} />}
      </div>
    </div>
  );
}
