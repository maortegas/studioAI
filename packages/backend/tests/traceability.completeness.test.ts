/**
 * Test: Completeness Dashboard Shows All Gaps Correctly
 * 
 * This test verifies that the traceability completeness dashboard
 * correctly identifies and displays all gaps in the development flow.
 * 
 * TODO 25: Test completeness dashboard shows all gaps correctly
 */

import { TraceabilityService } from '../src/services/traceabilityService';
import { TraceabilityRepository } from '../src/repositories/traceabilityRepository';

// Mock repository
jest.mock('../src/repositories/traceabilityRepository');

describe('Traceability Completeness Dashboard', () => {
  let traceabilityService: TraceabilityService;
  let mockTraceabilityRepo: jest.Mocked<TraceabilityRepository>;

  beforeEach(() => {
    mockTraceabilityRepo = new TraceabilityRepository() as jest.Mocked<TraceabilityRepository>;
    traceabilityService = new TraceabilityService(undefined, undefined, undefined, undefined, undefined, undefined, mockTraceabilityRepo);
    jest.clearAllMocks();
  });

  describe('Project Completeness Check', () => {
    it('should identify missing PRD', async () => {
      const completeness = {
        prd: { exists: false },
        stories: {
          total: 0,
          with_prd: 0,
          without_prd: [],
          with_design: 0,
          without_design: [],
          with_rfc: 0,
          without_rfc: [],
          with_coding: 0,
          without_coding: []
        },
        designs: {
          total: 0,
          with_stories: 0,
          without_stories: [],
          with_rfc: 0,
          without_rfc: []
        },
        rfc: {
          total: 0,
          approved: 0,
          not_approved: [],
          with_breakdown: 0,
          without_breakdown: []
        },
        breakdowns: {
          total: 0,
          with_rfc: 0,
          without_rfc: [],
          with_coding: 0,
          without_coding: []
        },
        gaps: ['PRD document is missing']
      };

      mockTraceabilityRepo.getProjectCompleteness = jest.fn().mockResolvedValue(completeness);

      const result = await traceabilityService.checkProjectCompleteness('project-1');

      expect(result.prd.exists).toBe(false);
      expect(result.gaps).toContain('PRD document is missing');
    });

    it('should identify stories without PRD', async () => {
      const completeness = {
        prd: { exists: true },
        stories: {
          total: 3,
          with_prd: 2,
          without_prd: [
            { id: 'story-1', title: 'Story without PRD' }
          ],
          with_design: 0,
          without_design: [],
          with_rfc: 0,
          without_rfc: [],
          with_coding: 0,
          without_coding: []
        },
        designs: {
          total: 0,
          with_stories: 0,
          without_stories: [],
          with_rfc: 0,
          without_rfc: []
        },
        rfc: {
          total: 0,
          approved: 0,
          not_approved: [],
          with_breakdown: 0,
          without_breakdown: []
        },
        breakdowns: {
          total: 0,
          with_rfc: 0,
          without_rfc: [],
          with_coding: 0,
          without_coding: []
        },
        gaps: ['1 story is not linked to PRD']
      };

      mockTraceabilityRepo.getProjectCompleteness = jest.fn().mockResolvedValue(completeness);

      const result = await traceabilityService.checkProjectCompleteness('project-1');

      expect(result.stories.without_prd.length).toBe(1);
      expect(result.stories.without_prd[0].title).toBe('Story without PRD');
      expect(result.gaps).toContain('1 story is not linked to PRD');
    });

    it('should identify stories without design', async () => {
      const completeness = {
        prd: { exists: true },
        stories: {
          total: 2,
          with_prd: 2,
          without_prd: [],
          with_design: 1,
          without_design: [
            { id: 'story-2', title: 'Story without design' }
          ],
          with_rfc: 0,
          without_rfc: [],
          with_coding: 0,
          without_coding: []
        },
        designs: {
          total: 1,
          with_stories: 1,
          without_stories: [],
          with_rfc: 0,
          without_rfc: []
        },
        rfc: {
          total: 0,
          approved: 0,
          not_approved: [],
          with_breakdown: 0,
          without_breakdown: []
        },
        breakdowns: {
          total: 0,
          with_rfc: 0,
          without_rfc: [],
          with_coding: 0,
          without_coding: []
        },
        gaps: ['1 story has no linked design']
      };

      mockTraceabilityRepo.getProjectCompleteness = jest.fn().mockResolvedValue(completeness);

      const missing = await traceabilityService.getMissingItems('project-1', 'design');

      expect(missing.length).toBeGreaterThan(0);
      expect(missing.some(m => m.title === 'Story without design')).toBe(true);
      expect(missing.some(m => m.reason.includes('no linked user flow'))).toBe(true);
    });

    it('should identify RFCs not approved', async () => {
      const completeness = {
        prd: { exists: true },
        stories: {
          total: 2,
          with_prd: 2,
          without_prd: [],
          with_design: 2,
          without_design: [],
          with_rfc: 2,
          without_rfc: [],
          with_coding: 0,
          without_coding: []
        },
        designs: {
          total: 2,
          with_stories: 2,
          without_stories: [],
          with_rfc: 2,
          without_rfc: []
        },
        rfc: {
          total: 2,
          approved: 1,
          not_approved: [
            { id: 'rfc-1', title: 'Draft RFC', status: 'draft' }
          ],
          with_breakdown: 0,
          without_breakdown: []
        },
        breakdowns: {
          total: 0,
          with_rfc: 0,
          without_rfc: [],
          with_coding: 0,
          without_coding: []
        },
        gaps: ['1 RFC is not approved']
      };

      mockTraceabilityRepo.getProjectCompleteness = jest.fn().mockResolvedValue(completeness);

      const missing = await traceabilityService.getMissingItems('project-1', 'rfc');

      expect(missing.length).toBeGreaterThan(0);
      expect(missing.some(m => m.title === 'Draft RFC')).toBe(true);
      expect(missing.some(m => m.reason.includes('not approved'))).toBe(true);
    });

    it('should identify RFCs without breakdown', async () => {
      const completeness = {
        prd: { exists: true },
        stories: {
          total: 2,
          with_prd: 2,
          without_prd: [],
          with_design: 2,
          without_design: [],
          with_rfc: 2,
          without_rfc: [],
          with_coding: 0,
          without_coding: []
        },
        designs: {
          total: 2,
          with_stories: 2,
          without_stories: [],
          with_rfc: 2,
          without_rfc: []
        },
        rfc: {
          total: 2,
          approved: 2,
          not_approved: [],
          with_breakdown: 1,
          without_breakdown: [
            { id: 'rfc-2', title: 'RFC without breakdown' }
          ]
        },
        breakdowns: {
          total: 1,
          with_rfc: 1,
          without_rfc: [],
          with_coding: 0,
          without_coding: []
        },
        gaps: ['1 RFC has no breakdown']
      };

      mockTraceabilityRepo.getProjectCompleteness = jest.fn().mockResolvedValue(completeness);

      const missing = await traceabilityService.getMissingItems('project-1', 'breakdown');

      expect(missing.length).toBeGreaterThan(0);
      expect(missing.some(m => m.title === 'RFC without breakdown')).toBe(true);
      expect(missing.some(m => m.reason.includes('no breakdown'))).toBe(true);
    });

    it('should identify stories without coding sessions', async () => {
      const completeness = {
        prd: { exists: true },
        stories: {
          total: 3,
          with_prd: 3,
          without_prd: [],
          with_design: 3,
          without_design: [],
          with_rfc: 3,
          without_rfc: [],
          with_coding: 1,
          without_coding: [
            { id: 'story-2', title: 'Story without coding' },
            { id: 'story-3', title: 'Another story without coding' }
          ]
        },
        designs: {
          total: 3,
          with_stories: 3,
          without_stories: [],
          with_rfc: 3,
          without_rfc: []
        },
        rfc: {
          total: 3,
          approved: 3,
          not_approved: [],
          with_breakdown: 3,
          without_breakdown: []
        },
        breakdowns: {
          total: 3,
          with_rfc: 3,
          without_rfc: [],
          with_coding: 1,
          without_coding: []
        },
        gaps: ['2 stories have no coding sessions']
      };

      mockTraceabilityRepo.getProjectCompleteness = jest.fn().mockResolvedValue(completeness);

      const missing = await traceabilityService.getMissingItems('project-1', 'coding');

      expect(missing.length).toBe(2);
      expect(missing.some(m => m.title === 'Story without coding')).toBe(true);
      expect(missing.some(m => m.title === 'Another story without coding')).toBe(true);
      expect(missing.every(m => m.reason.includes('no coding session'))).toBe(true);
    });
  });

  describe('Recommendations', () => {
    it('should provide high priority recommendation for missing PRD', async () => {
      const completeness = {
        prd: { exists: false },
        stories: {
          total: 0,
          with_prd: 0,
          without_prd: [],
          with_design: 0,
          without_design: [],
          with_rfc: 0,
          without_rfc: [],
          with_coding: 0,
          without_coding: []
        },
        designs: {
          total: 0,
          with_stories: 0,
          without_stories: [],
          with_rfc: 0,
          without_rfc: []
        },
        rfc: {
          total: 0,
          approved: 0,
          not_approved: [],
          with_breakdown: 0,
          without_breakdown: []
        },
        breakdowns: {
          total: 0,
          with_rfc: 0,
          without_rfc: [],
          with_coding: 0,
          without_coding: []
        },
        gaps: []
      };

      mockTraceabilityRepo.getProjectCompleteness = jest.fn().mockResolvedValue(completeness);

      const recommendations = await traceabilityService.getRecommendations('project-1');

      expect(recommendations.length).toBeGreaterThan(0);
      const prdRecommendation = recommendations.find(r => r.action.includes('PRD'));
      expect(prdRecommendation).toBeDefined();
      expect(prdRecommendation?.priority).toBe('high');
    });

    it('should provide recommendations for all gaps', async () => {
      const completeness = {
        prd: { exists: true },
        stories: {
          total: 3,
          with_prd: 2,
          without_prd: [{ id: 'story-1', title: 'Story 1' }],
          with_design: 1,
          without_design: [{ id: 'story-2', title: 'Story 2' }],
          with_rfc: 0,
          without_rfc: [],
          with_coding: 0,
          without_coding: [{ id: 'story-3', title: 'Story 3' }]
        },
        designs: {
          total: 1,
          with_stories: 1,
          without_stories: [],
          with_rfc: 0,
          without_rfc: [{ id: 'design-1', flow_name: 'Design 1' }]
        },
        rfc: {
          total: 1,
          approved: 0,
          not_approved: [{ id: 'rfc-1', title: 'RFC 1', status: 'draft' }],
          with_breakdown: 0,
          without_breakdown: []
        },
        breakdowns: {
          total: 0,
          with_rfc: 0,
          without_rfc: [],
          with_coding: 0,
          without_coding: []
        },
        gaps: []
      };

      mockTraceabilityRepo.getProjectCompleteness = jest.fn().mockResolvedValue(completeness);

      const recommendations = await traceabilityService.getRecommendations('project-1');

      // Should have recommendations for:
      // - Stories without PRD (high)
      // - Stories without design (medium)
      // - Designs without RFC (medium)
      // - RFCs not approved (high)
      // - Stories without coding (low)
      expect(recommendations.length).toBeGreaterThanOrEqual(5);

      const highPriority = recommendations.filter(r => r.priority === 'high');
      expect(highPriority.length).toBeGreaterThan(0);

      const mediumPriority = recommendations.filter(r => r.priority === 'medium');
      expect(mediumPriority.length).toBeGreaterThan(0);

      const lowPriority = recommendations.filter(r => r.priority === 'low');
      expect(lowPriority.length).toBeGreaterThan(0);
    });
  });
});

