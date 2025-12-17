import { useEffect, useState } from 'react';
import { TestPlan, TestPlanItem, TestType } from '@devflow-studio/shared';
import { integrationTestPlansApi } from '../api/integrationTestPlans';
import { useToast } from '../context/ToastContext';

interface IntegrationTestPlanEditorProps {
  projectId: string;
  qaSessionId?: string;
  codingSessionId?: string;
  testType?: TestType;
  onPlanExecuted?: (qaSessionId: string) => void;
  onClose?: () => void;
  onSessionCreated?: (qaSessionId: string) => void; // Callback when a new session is created
}

export default function IntegrationTestPlanEditor({
  projectId,
  qaSessionId,
  codingSessionId,
  testType,
  onPlanExecuted,
  onClose,
  onSessionCreated,
}: IntegrationTestPlanEditorProps) {
  const [plan, setPlan] = useState<TestPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [editingItem, setEditingItem] = useState<TestPlanItem | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [mode, setMode] = useState<'manual' | 'ai' | null>(null); // null = initial, manual = writing manually, ai = generating with AI
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(qaSessionId); // Track current session ID
  const { showToast } = useToast();

  // Update currentSessionId when qaSessionId prop changes
  useEffect(() => {
    if (qaSessionId) {
      setCurrentSessionId(qaSessionId);
      // Reset plan when session changes to force reload
      setPlan(null);
      setLoading(true);
      // Reset mode to allow proper loading
      if (mode === null) {
        // Will be set to 'ai' when plan loads if it has items
      }
    } else {
      setCurrentSessionId(undefined);
    }
  }, [qaSessionId]);

  useEffect(() => {
    // Only load plan if we have a currentSessionId (existing plan)
    if (currentSessionId) {
      loadPlan();
      
      // Poll for plan updates if we're waiting for generation
      // IMPORTANT: This polling does NOT close the modal - it just updates the plan
      if (!plan) {
        const interval = setInterval(() => {
          loadPlan(true); // Silent polling - don't show errors for 404
        }, 3000);
        return () => clearInterval(interval);
      }
    } else {
      // No session yet - this is a new plan creation
      setLoading(false);
      setPlan(null);
    }
  }, [projectId, currentSessionId, codingSessionId]);

  const loadPlan = async (silent: boolean = false) => {
    const sessionIdToUse = currentSessionId || qaSessionId;
    if (!silent) {
      setLoading(true);
    }
    try {
      let loadedPlan: TestPlan | null = null;

      if (sessionIdToUse) {
        try {
          loadedPlan = await integrationTestPlansApi.getPlanByQASession(sessionIdToUse);
          if (loadedPlan) {
            setPlan(loadedPlan);
            // If we have a plan, we're not in initial mode anymore
            if (mode === null && loadedPlan.items.length > 0) {
              setMode('ai'); // Plan was generated with AI
            }
          }
        } catch (error: any) {
          // 404 is expected when plan doesn't exist yet (during generation)
          if (error.response?.status === 404) {
            if (!silent) {
              // Plan doesn't exist yet, that's ok - it will be created by the worker
              setPlan(null);
            }
            // Don't show error for 404 during polling
            return;
          }
          // For other errors, throw to be handled below
          if (!silent) {
            throw error;
          }
        }
      } else if (codingSessionId) {
        try {
          loadedPlan = await integrationTestPlansApi.getPlanByCodingSession(codingSessionId);
          if (loadedPlan) {
            setPlan(loadedPlan);
            if (mode === null && loadedPlan.items.length > 0) {
              setMode('ai');
            }
          }
        } catch (error: any) {
          if (error.response?.status === 404) {
            if (!silent) {
              setPlan(null);
            }
            return;
          }
          if (!silent) {
            throw error;
          }
        }
      } else {
        setPlan(null);
      }
    } catch (error: any) {
      if (!silent) {
        console.error('Failed to load test plan:', error);
        showToast('Failed to load test plan', 'error');
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  const handleStartManual = () => {
    // Initialize empty plan for manual creation
    setMode('manual');
    const newItem: TestPlanItem = {
      id: `item-${Date.now()}`,
      test_name: '',
      description: '',
      priority: 'medium',
    };
    setPlan({
      id: 'temp-' + Date.now(),
      project_id: projectId,
      qa_session_id: qaSessionId,
      coding_session_id: codingSessionId,
      test_type: testType || 'unit',
      items: [],
      status: 'draft',
      created_at: new Date(),
      updated_at: new Date(),
    });
    // Open add item form immediately
    setEditingItem(newItem);
  };

  const handleGeneratePlan = async () => {
    if (!testType) {
      showToast('Test type is required', 'error');
      return;
    }

    setMode('ai');
    setGenerating(true);
    
    try {
      // First create QA session if we don't have one (without auto_run)
      let sessionId = currentSessionId || qaSessionId;
      if (!sessionId) {
        const { qaApi } = await import('../api/qa');
        const session = await qaApi.create({
          project_id: projectId,
          coding_session_id: codingSessionId,
          test_type: testType,
          auto_run: false, // Don't run automatically, just create the session for plan generation
        });
        sessionId = session.id;
        setCurrentSessionId(sessionId); // Update local state
        // Notify parent component about the new session
        if (onSessionCreated) {
          onSessionCreated(sessionId);
        }
      }

      // Generate plan
      const result = await integrationTestPlansApi.generatePlan({
        project_id: projectId,
        qa_session_id: sessionId,
        coding_session_id: codingSessionId,
        test_type: testType,
      });
      setPlan(result.plan);
      showToast(`${testType} test plan generation started. Please wait while the plan is being generated...`, 'info');
      
      // Poll for plan updates until it's ready (items are populated)
      // IMPORTANT: The modal will remain open - user must review, approve, and execute manually
      // NO automatic execution, NO automatic modal closing
      let pollCount = 0;
      const maxPolls = 30; // Poll for up to 60 seconds (30 * 2s)
      
      const pollInterval = setInterval(async () => {
        pollCount++;
        try {
          const updatedPlan = await integrationTestPlansApi.getPlanByQASession(sessionId);
          if (updatedPlan) {
            setPlan(updatedPlan);
            setLoading(false); // Ensure loading is false when plan is found
            
            // If plan has items, it's ready for review
            if (updatedPlan.items.length > 0) {
              clearInterval(pollInterval);
              setGenerating(false); // Stop showing "generating" state
              showToast('Test plan generated successfully! Please review the plan, approve it, and then execute when ready.', 'success');
              // Modal stays open - user controls when to approve and execute
            } else {
              // Plan exists but no items yet - worker is still processing
              // Keep showing generating state and continue polling
              // Don't log to console to avoid spam
            }
          }
        } catch (error: any) {
          // 404 is expected when plan doesn't exist yet - that's ok, keep polling
          if (error.response?.status === 404) {
            // Plan not created yet by worker, continue polling silently
            // Don't log to avoid console spam
          } else {
            // Other errors - log but continue polling
            console.error('Error polling for plan:', error);
          }
        }
        
        // Stop polling after max attempts
        if (pollCount >= maxPolls) {
          clearInterval(pollInterval);
          setGenerating(false);
          setLoading(false);
          // Final load attempt (silent to avoid error toast)
          await loadPlan(true);
          if (plan && plan.items.length === 0) {
            showToast('Plan generation is taking longer than expected. The plan may still be processing. You can refresh the page to check again.', 'warning');
          } else if (!plan) {
            showToast('Plan generation may still be in progress. The plan will appear when ready.', 'info');
          }
        }
      }, 2000);
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to generate plan', 'error');
      setMode(null);
    } finally {
      setGenerating(false);
    }
  };

  const handleSavePlan = async () => {
    if (!plan) return;

    setSaving(true);
    try {
      // If plan has temp ID, we need to create it first (manual creation)
      if (plan && plan.id.startsWith('temp-')) {
        // Create QA session first (without auto_run)
        const { qaApi } = await import('../api/qa');
        const session = await qaApi.create({
          project_id: projectId,
          coding_session_id: codingSessionId,
          test_type: plan.test_type || testType || 'unit',
          auto_run: false, // Don't run automatically, just create the session
        });

        // Create plan via API (with empty items first)
        const createResult = await integrationTestPlansApi.generatePlan({
          project_id: projectId,
          qa_session_id: session.id,
          coding_session_id: codingSessionId,
          test_type: plan.test_type || testType || 'unit',
        });

        // Update plan with items
        const result = await integrationTestPlansApi.updatePlan(createResult.plan.id, {
          items: plan.items,
          status: plan.status,
        });
        setPlan(result.plan);
        // Update qaSessionId so we can continue editing
        if (!qaSessionId) {
          // This will trigger a re-render with the new session ID
          window.location.reload(); // Simple approach - could be improved with state management
        }
        showToast('Plan created and saved successfully', 'success');
      } else {
        // Update existing plan
        const result = await integrationTestPlansApi.updatePlan(plan.id, {
          items: plan.items,
          status: plan.status,
        });
        setPlan(result.plan);
        showToast('Plan saved successfully', 'success');
      }
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to save plan', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleExecutePlan = async () => {
    if (!plan) return;

    if (plan.items.length === 0) {
      showToast('Cannot execute plan with no test items', 'error');
      return;
    }

    if (plan.status !== 'approved') {
      showToast('Plan must be approved before execution. Please approve the plan first.', 'error');
      return;
    }

    // Confirm execution with user
    if (!confirm('Are you sure you want to execute this test plan? This will start running the tests.')) {
      return;
    }

    setExecuting(true);
    try {
      const result = await integrationTestPlansApi.executePlan(plan.id);
      showToast('Test execution started', 'success');
      // Only close modal after user explicitly executes - NEVER after generation
      // User has full control: generate -> review -> approve -> execute -> close
      if (onPlanExecuted) {
        onPlanExecuted(result.qa_session_id);
      }
      await loadPlan();
    } catch (error: any) {
      showToast(error.response?.data?.error || 'Failed to execute plan', 'error');
    } finally {
      setExecuting(false);
    }
  };

  const handleEditItem = (item: IntegrationTestPlanItem) => {
    setEditingItem({ ...item });
  };

  const handleSaveItem = async () => {
    if (!plan || !editingItem) return;

    const updatedItems = plan.items.map(item =>
      item.id === editingItem.id ? editingItem : item
    );
    setPlan({ ...plan, items: updatedItems });
    setEditingItem(null);
    
    try {
      await handleSavePlan();
    } catch (error: any) {
      // Revert on error
      setPlan({ ...plan, items: plan.items });
      showToast(error.response?.data?.error || 'Failed to save item', 'error');
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!plan) return;

    if (!confirm('Are you sure you want to delete this test item?')) {
      return;
    }

    // Save original items in case we need to revert
    const originalItems = [...plan.items];
    
    // Update local state immediately for better UX
    const updatedItems = plan.items.filter(item => item.id !== itemId);
    setPlan({ ...plan, items: updatedItems });
    
    // Save to backend
    try {
      // If plan has temp ID, we need to create it first
      if (plan.id.startsWith('temp-')) {
        // For temp plans, just update local state - will be saved when plan is created
        showToast('Test item deleted', 'success');
        return;
      }
      
      // Update existing plan
      const result = await integrationTestPlansApi.updatePlan(plan.id, {
        items: updatedItems,
        status: plan.status,
      });
      setPlan(result.plan);
      showToast('Test item deleted successfully', 'success');
    } catch (error: any) {
      // If save fails, revert the change
      setPlan({ ...plan, items: originalItems });
      showToast(error.response?.data?.error || 'Failed to delete test item', 'error');
    }
  };

  const handleAddItem = () => {
    if (!plan) return;

    const newItem: TestPlanItem = {
      id: `item-${Date.now()}`,
      test_name: '',
      description: '',
      priority: 'medium',
    };
    setEditingItem(newItem);
    setShowAddForm(false);
  };

  const handleSaveNewItem = async () => {
    if (!plan || !editingItem) return;

    if (!editingItem.test_name || !editingItem.description) {
      showToast('Test name and description are required', 'error');
      return;
    }

    const updatedItems = [...plan.items, editingItem];
    setPlan({ ...plan, items: updatedItems });
    setEditingItem(null);
    
    try {
      await handleSavePlan();
    } catch (error: any) {
      // Revert on error - remove the item we just added
      setPlan({ ...plan, items: plan.items });
      showToast(error.response?.data?.error || 'Failed to save new item', 'error');
    }
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300';
      case 'medium':
        return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300';
      case 'low':
        return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300';
      default:
        return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft':
        return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300';
      case 'approved':
        return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300';
      case 'executing':
        return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300';
      case 'completed':
        return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300';
      default:
        return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300';
    }
  };

  if (loading || (generating && !plan)) {
    return (
      <div className="text-center py-8">
        <div className="text-gray-900 dark:text-white mb-4">
          {generating ? 'Generating test plan with AI...' : 'Loading test plan...'}
        </div>
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400"></div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
          This may take a few moments
        </p>
      </div>
    );
  }

  // Show generating state if plan exists but has no items yet (worker is still processing)
  // This can happen when the plan was created but the worker hasn't populated items yet
  if (plan && plan.items.length === 0 && (generating || mode === 'ai')) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 dark:border-blue-400 mb-4"></div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Generating {testType ? `${testType.charAt(0).toUpperCase() + testType.slice(1)} ` : ''}Test Plan
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-4">
            The AI is analyzing your project and creating a comprehensive test plan...
          </p>
          <p className="text-sm text-gray-400 dark:text-gray-500">
            This may take a minute or two. The plan will appear automatically when ready.
          </p>
        </div>
      </div>
    );
  }

  if (!plan && mode === null) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50 p-6">
        <div className="text-center">
          <div className="text-4xl mb-4">📋</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Create {testType ? `${testType.charAt(0).toUpperCase() + testType.slice(1)} ` : ''}Test Plan
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Choose how you want to create your test plan:
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button
              onClick={handleStartManual}
              disabled={!testType}
              className="px-6 py-3 bg-gray-600 dark:bg-gray-500 text-white rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              <span>✏️</span>
              <span>Write Manually</span>
            </button>
            <button
              onClick={handleGeneratePlan}
              disabled={generating || !testType}
              className="px-6 py-3 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition disabled:opacity-50 flex items-center justify-center space-x-2"
            >
              <span>🤖</span>
              <span>{generating ? 'Generating...' : 'Generate with AI'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If plan is null but mode is set, show empty plan for manual creation
  if (!plan && mode === 'manual') {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50">
          <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {testType ? `${testType.charAt(0).toUpperCase() + testType.slice(1)} ` : ''}Test Plan (Manual)
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Write your test plan manually
              </p>
            </div>
            <div className="flex space-x-2">
              {onClose && (
                <button
                  onClick={onClose}
                  className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          <div className="p-6">
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <p className="mb-4">Start by adding your first test item</p>
              <button
                onClick={handleStartManual}
                className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition"
              >
                + Add First Test Item
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Safety check: if plan is null, return early
  if (!plan) {
    return null;
  }

  // Safety check: if plan is null at this point, return null
  if (!plan) {
    return null;
  }

  const isNewItem = editingItem && !plan.items.find(item => item.id === editingItem.id);

  return (
    <div className="space-y-6">
      {/* Plan Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow dark:shadow-gray-700/50">
        <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
              {plan.test_type ? `${plan.test_type.charAt(0).toUpperCase() + plan.test_type.slice(1)} ` : ''}Test Plan
              {mode === 'manual' && ' (Manual)'}
              {mode === 'ai' && generating && ' (Generating...)'}
            </h2>
            <div className="flex items-center space-x-2 mt-2">
              <span className={`px-2 py-1 text-xs rounded-full font-medium ${getStatusColor(plan.status)}`}>
                {plan.status}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {plan.items.length} test{plan.items.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>
          <div className="flex space-x-2">
            {onClose && (
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition"
              >
                Close
              </button>
            )}
            {plan.status === 'draft' && (
              <>
                <button
                  onClick={handleSavePlan}
                  disabled={saving}
                  className="px-4 py-2 bg-gray-600 dark:bg-gray-500 text-white rounded-lg hover:bg-gray-700 dark:hover:bg-gray-600 transition disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Plan'}
                </button>
                <button
                  onClick={async () => {
                    if (plan.items.length === 0) {
                      showToast('Cannot approve plan with no test items', 'error');
                      return;
                    }
                    setPlan({ ...plan, status: 'approved' });
                    await handleSavePlan();
                    showToast('Plan approved! You can now execute the tests.', 'success');
                  }}
                  disabled={plan.items.length === 0}
                  className="px-4 py-2 bg-green-600 dark:bg-green-500 text-white rounded-lg hover:bg-green-700 dark:hover:bg-green-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Approve Plan
                </button>
              </>
            )}
            {plan.status === 'approved' && (
              <button
                onClick={handleExecutePlan}
                disabled={executing || plan.items.length === 0}
                className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition disabled:opacity-50"
              >
                {executing ? 'Executing...' : 'Execute Tests'}
              </button>
            )}
          </div>
        </div>

        {/* Plan Items */}
        <div className="p-6">
          {plan.items.length === 0 ? (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              No test items in plan. Add items to create a test plan.
            </div>
          ) : (
            <div className="space-y-3">
              {plan.items.map((item, index) => (
                <div
                  key={item.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800 hover:shadow-md dark:hover:shadow-gray-700/50 transition"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">#{index + 1}</span>
                        <h3 className="font-semibold text-gray-900 dark:text-white">{item.test_name || 'Unnamed Test'}</h3>
                        {item.priority && (
                          <span className={`px-2 py-1 text-xs rounded-full font-medium ${getPriorityColor(item.priority)}`}>
                            {item.priority}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{item.description}</p>
                      <div className="flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
                        {plan.test_type === 'unit' && item.component && (
                          <span>
                            <strong>Component:</strong> {item.component}
                          </span>
                        )}
                        {(plan.test_type === 'integration' || plan.test_type === 'e2e') && item.endpoint && (
                          <span>
                            <strong>Endpoint:</strong> {item.method || 'GET'} {item.endpoint}
                          </span>
                        )}
                        {plan.test_type === 'e2e' && item.user_flow && (
                          <span>
                            <strong>User Flow:</strong> {item.user_flow}
                          </span>
                        )}
                        {plan.test_type === 'contract' && (
                          <>
                            {item.contract_consumer && (
                              <span>
                                <strong>Consumer:</strong> {item.contract_consumer}
                              </span>
                            )}
                            {item.contract_provider && (
                              <span>
                                <strong>Provider:</strong> {item.contract_provider}
                              </span>
                            )}
                          </>
                        )}
                        {plan.test_type === 'load' && (
                          <>
                            {item.load_scenario && (
                              <span>
                                <strong>Scenario:</strong> {item.load_scenario}
                              </span>
                            )}
                            {item.expected_throughput && (
                              <span>
                                <strong>Throughput:</strong> {item.expected_throughput} req/s
                              </span>
                            )}
                            {item.expected_response_time && (
                              <span>
                                <strong>Response Time:</strong> {item.expected_response_time}ms
                              </span>
                            )}
                          </>
                        )}
                        {item.expected_status && (
                          <span>
                            <strong>Expected Status:</strong> {item.expected_status}
                          </span>
                        )}
                        {item.dependencies && item.dependencies.length > 0 && (
                          <span>
                            <strong>Dependencies:</strong> {item.dependencies.length}
                          </span>
                        )}
                      </div>
                    </div>
                    {plan.status === 'draft' && (
                      <div className="flex space-x-2 ml-4">
                        <button
                          onClick={() => handleEditItem(item)}
                          className="px-3 py-1 text-sm bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteItem(item.id)}
                          className="px-3 py-1 text-sm bg-red-600 dark:bg-red-500 text-white rounded-lg hover:bg-red-700 dark:hover:bg-red-600 transition"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {plan.status === 'draft' && (
            <div className="mt-4">
              <button
                onClick={handleAddItem}
                className="w-full px-4 py-2 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 hover:border-blue-500 dark:hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition"
              >
                + Add Test Item
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Edit/Add Item Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-between items-center sticky top-0 bg-white dark:bg-gray-800">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                {isNewItem ? 'Add Test Item' : 'Edit Test Item'}
              </h2>
              <button
                onClick={() => setEditingItem(null)}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Test Name *
                </label>
                <input
                  type="text"
                  value={editingItem.test_name}
                  onChange={(e) => setEditingItem({ ...editingItem, test_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Test User Registration Endpoint"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Description *
                </label>
                <textarea
                  value={editingItem.description}
                  onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  placeholder="Describe what this test will verify..."
                />
              </div>

              {/* Type-specific fields */}
              {plan?.test_type === 'unit' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Component/Function Name
                  </label>
                  <input
                    type="text"
                    value={editingItem.component || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, component: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                    placeholder="UserService.createUser"
                  />
                </div>
              )}

              {(plan?.test_type === 'integration' || plan?.test_type === 'e2e') && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Endpoint
                    </label>
                    <input
                      type="text"
                      value={editingItem.endpoint || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, endpoint: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                      placeholder="/api/users"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      HTTP Method
                    </label>
                    <select
                      value={editingItem.method || 'GET'}
                      onChange={(e) => setEditingItem({ ...editingItem, method: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="PATCH">PATCH</option>
                      <option value="DELETE">DELETE</option>
                    </select>
                  </div>
                </div>
              )}

              {plan?.test_type === 'e2e' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    User Flow Description
                  </label>
                  <textarea
                    value={editingItem.user_flow || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, user_flow: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                    placeholder="User logs in, navigates to dashboard, creates a new item..."
                  />
                </div>
              )}

              {plan?.test_type === 'contract' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Consumer Service
                    </label>
                    <input
                      type="text"
                      value={editingItem.contract_consumer || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, contract_consumer: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                      placeholder="user-service"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Provider Service
                    </label>
                    <input
                      type="text"
                      value={editingItem.contract_provider || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, contract_provider: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                      placeholder="api-service"
                    />
                  </div>
                </div>
              )}

              {plan?.test_type === 'load' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Load Scenario Description (Critical Process)
                    </label>
                    <textarea
                      value={editingItem.load_scenario || ''}
                      onChange={(e) => setEditingItem({ ...editingItem, load_scenario: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                      placeholder="Critical process: 100 concurrent users, 1000 requests per second..."
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Expected Throughput (req/s)
                      </label>
                      <input
                        type="number"
                        value={editingItem.expected_throughput || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, expected_throughput: parseInt(e.target.value) || undefined })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                        placeholder="1000"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Expected Response Time (ms)
                      </label>
                      <input
                        type="number"
                        value={editingItem.expected_response_time || ''}
                        onChange={(e) => setEditingItem({ ...editingItem, expected_response_time: parseInt(e.target.value) || undefined })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                        placeholder="200"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Expected Status Code
                  </label>
                  <input
                    type="number"
                    value={editingItem.expected_status || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, expected_status: parseInt(e.target.value) || undefined })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                    placeholder="200"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Priority
                  </label>
                  <select
                    value={editingItem.priority || 'medium'}
                    onChange={(e) => setEditingItem({ ...editingItem, priority: e.target.value as 'high' | 'medium' | 'low' })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Test Data (JSON)
                </label>
                <textarea
                  value={editingItem.test_data ? JSON.stringify(editingItem.test_data, null, 2) : ''}
                  onChange={(e) => {
                    try {
                      const data = e.target.value ? JSON.parse(e.target.value) : undefined;
                      setEditingItem({ ...editingItem, test_data: data });
                    } catch {
                      // Invalid JSON, keep as is
                    }
                  }}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm focus:ring-2 focus:ring-blue-500"
                  placeholder='{"key": "value"}'
                />
              </div>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-end space-x-3">
              <button
                onClick={() => setEditingItem(null)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition"
              >
                Cancel
              </button>
              <button
                onClick={isNewItem ? handleSaveNewItem : handleSaveItem}
                className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition"
              >
                {isNewItem ? 'Add Item' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
