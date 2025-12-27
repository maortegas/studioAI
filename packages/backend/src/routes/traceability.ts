import { Router, Request, Response } from 'express';
import { TraceabilityService } from '../services/traceabilityService';

const router = Router();
const traceabilityService = new TraceabilityService();

/**
 * GET /api/traceability/project/:projectId
 * Get traceability dashboard for a project
 */
router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    // Get completeness data
    const completeness = await traceabilityService.checkProjectCompleteness(projectId);

    // Get recommendations
    const recommendations = await traceabilityService.getRecommendations(projectId);

    // Calculate overall completeness percentage
    const totalSteps = 6; // PRD, Stories, Design, RFC, Breakdown, Coding
    let completedSteps = 0;

    if (completeness.prd.exists) completedSteps++;
    if (completeness.stories.total > 0 && completeness.stories.with_prd === completeness.stories.total) completedSteps++;
    if (completeness.designs.total > 0 && completeness.designs.with_stories === completeness.designs.total) completedSteps++;
    if (completeness.rfc.total > 0 && completeness.rfc.approved === completeness.rfc.total) completedSteps++;
    if (completeness.breakdowns.total > 0 && completeness.breakdowns.with_rfc === completeness.breakdowns.total) completedSteps++;
    if (completeness.stories.with_coding > 0 || completeness.breakdowns.with_coding > 0) completedSteps++;

    const overallCompleteness = Math.round((completedSteps / totalSteps) * 100);

    res.json({
      project_id: projectId,
      completeness: {
        overall: overallCompleteness,
        prd: completeness.prd,
        stories: completeness.stories,
        designs: completeness.designs,
        rfc: completeness.rfc,
        breakdowns: completeness.breakdowns,
      },
      gaps: completeness.gaps,
      recommendations,
      flow_status: {
        prd: completeness.prd.exists ? 'complete' : 'missing',
        stories: completeness.stories.total > 0 ? 
          (completeness.stories.without_prd.length === 0 ? 'complete' : 'partial') : 'missing',
        design: completeness.designs.total > 0 ?
          (completeness.designs.without_stories.length === 0 && completeness.stories.without_design.length === 0 ? 'complete' : 'partial') : 'missing',
        rfc: completeness.rfc.total > 0 ?
          (completeness.rfc.approved === completeness.rfc.total && completeness.rfc.without_breakdown.length === 0 ? 'complete' : 'partial') : 'missing',
        breakdown: completeness.breakdowns.total > 0 ?
          (completeness.breakdowns.without_rfc.length === 0 ? 'complete' : 'partial') : 'missing',
        coding: (completeness.stories.with_coding > 0 || completeness.breakdowns.with_coding > 0) ? 'in_progress' : 'not_started',
      }
    });
  } catch (error: any) {
    console.error('[Traceability] Error getting project traceability:', error);
    res.status(500).json({ error: error.message || 'Failed to get traceability data' });
  }
});

/**
 * GET /api/traceability/story/:storyId
 * Get full traceability chain for a story
 */
router.get('/story/:storyId', async (req: Request, res: Response) => {
  try {
    const { storyId } = req.params;
    const traceability = await traceabilityService.getStoryTraceability(storyId);

    res.json(traceability);
  } catch (error: any) {
    console.error('[Traceability] Error getting story traceability:', error);
    res.status(500).json({ error: error.message || 'Failed to get story traceability' });
  }
});

/**
 * POST /api/traceability/validate
 * Validate if an item can proceed to the next step
 */
router.post('/validate', async (req: Request, res: Response) => {
  try {
    const { item_id, item_type, next_step } = req.body;

    if (!item_id || !item_type || !next_step) {
      return res.status(400).json({ error: 'Missing required fields: item_id, item_type, next_step' });
    }

    const validation = await traceabilityService.validateCanProceed(
      item_id,
      item_type,
      next_step
    );

    res.json(validation);
  } catch (error: any) {
    console.error('[Traceability] Error validating traceability:', error);
    res.status(500).json({ error: error.message || 'Failed to validate traceability' });
  }
});

/**
 * GET /api/traceability/missing/:projectId/:step
 * Get missing items at a specific step
 */
router.get('/missing/:projectId/:step', async (req: Request, res: Response) => {
  try {
    const { projectId, step } = req.params;

    const validSteps = ['prd', 'stories', 'design', 'rfc', 'breakdown', 'coding'];
    if (!validSteps.includes(step)) {
      return res.status(400).json({ error: `Invalid step. Must be one of: ${validSteps.join(', ')}` });
    }

    const missing = await traceabilityService.getMissingItems(projectId, step as any);

    res.json({ project_id: projectId, step, missing });
  } catch (error: any) {
    console.error('[Traceability] Error getting missing items:', error);
    res.status(500).json({ error: error.message || 'Failed to get missing items' });
  }
});

export default router;

