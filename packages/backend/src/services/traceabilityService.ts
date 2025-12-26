import { TraceabilityRepository, ProjectCompleteness, TraceabilityGap } from '../repositories/traceabilityRepository';
import { TaskRepository } from '../repositories/taskRepository';
import { PRDRepository } from '../repositories/prdRepository';
import { UserFlowRepository } from '../repositories/userFlowRepository';
import { RFCRepository } from '../repositories/rfcRepository';
import { EpicRepository } from '../repositories/epicRepository';
import { CodingSessionRepository } from '../repositories/codingSessionRepository';

export interface ValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

export class TraceabilityService {
  private traceabilityRepo: TraceabilityRepository;
  private taskRepo: TaskRepository;
  private prdRepo: PRDRepository;
  private userFlowRepo: UserFlowRepository;
  private rfcRepo: RFCRepository;
  private epicRepo: EpicRepository;
  private sessionRepo: CodingSessionRepository;

  constructor(
    taskRepo?: TaskRepository,
    prdRepo?: PRDRepository,
    userFlowRepo?: UserFlowRepository,
    rfcRepo?: RFCRepository,
    epicRepo?: EpicRepository,
    sessionRepo?: CodingSessionRepository,
    traceabilityRepo?: TraceabilityRepository
  ) {
    this.traceabilityRepo = traceabilityRepo || new TraceabilityRepository();
    this.taskRepo = taskRepo || new TaskRepository();
    this.prdRepo = prdRepo || new PRDRepository();
    this.userFlowRepo = userFlowRepo || new UserFlowRepository();
    this.rfcRepo = rfcRepo || new RFCRepository();
    this.epicRepo = epicRepo || new EpicRepository();
    this.sessionRepo = sessionRepo || new CodingSessionRepository();
  }

  /**
   * Check completeness of entire project flow
   */
  async checkProjectCompleteness(projectId: string): Promise<ProjectCompleteness> {
    return await this.traceabilityRepo.getProjectCompleteness(projectId);
  }

  /**
   * Get full traceability chain for a story
   */
  async getStoryTraceability(storyId: string): Promise<{
    story: any;
    prd?: any;
    designs?: any[];
    rfc?: any;
    epic?: any;
    breakdownTasks?: any[];
    codingSessions?: any[];
    gaps: string[];
  }> {
    return await this.traceabilityRepo.getStoryTraceability(storyId);
  }

  /**
   * Validate if an item can proceed to the next step
   */
  async validateCanProceed(itemId: string, itemType: 'story' | 'design' | 'rfc' | 'epic', nextStep: 'design' | 'rfc' | 'breakdown' | 'coding'): Promise<ValidationResult> {
    const missing: string[] = [];
    const warnings: string[] = [];

    if (itemType === 'story' && nextStep === 'design') {
      // Story → Design: Must have PRD
      const story = await this.taskRepo.findById(itemId);
      if (!story) {
        return { valid: false, missing: ['Story not found'], warnings: [] };
      }
      // Check if story has prd_id (may be stored in database but not in type)
      const storyWithPRD = story as any;
      if (!storyWithPRD.prd_id) {
        missing.push('Story must be linked to a PRD');
      }
    }

    if (itemType === 'story' && nextStep === 'rfc') {
      // Story → RFC: Should have design (warning if missing)
      const story = await this.taskRepo.findById(itemId);
      if (!story) {
        return { valid: false, missing: ['Story not found'], warnings: [] };
      }
      const traceability = await this.traceabilityRepo.getStoryTraceability(itemId);
      if (!traceability.designs || traceability.designs.length === 0) {
        warnings.push('Story has no linked design (user flow). RFC generation may be less accurate.');
      }
    }

    if (itemType === 'design' && nextStep === 'rfc') {
      // Design → RFC: Should have stories (warning if missing)
      const { StoryUserFlowRepository } = await import('../repositories/storyUserFlowRepository');
      const storyFlowRepo = new StoryUserFlowRepository();
      const linkedStories = await storyFlowRepo.findByUserFlowId(itemId);
      if (linkedStories.length === 0) {
        warnings.push('User flow has no linked stories. RFC generation may be less accurate.');
      }
    }

    if (itemType === 'rfc' && nextStep === 'breakdown') {
      // RFC → Breakdown: Must be approved
      const rfc = await this.rfcRepo.findById(itemId);
      if (!rfc) {
        return { valid: false, missing: ['RFC not found'], warnings: [] };
      }
      if (rfc.status !== 'approved') {
        missing.push(`RFC must be approved before breakdown. Current status: ${rfc.status}`);
      }
    }

    if (itemType === 'epic' && nextStep === 'coding') {
      // Epic → Coding: Must have RFC
      const epic = await this.epicRepo.findById(itemId);
      if (!epic) {
        return { valid: false, missing: ['Epic not found'], warnings: [] };
      }
      if (!epic.rfc_id) {
        missing.push('Epic must have an RFC before coding');
      } else {
        // Verify RFC is approved
        const rfc = await this.rfcRepo.findById(epic.rfc_id);
        if (!rfc) {
          missing.push('Epic references an RFC that does not exist');
        } else if (rfc.status !== 'approved') {
          warnings.push(`Epic's RFC is not approved (status: ${rfc.status}). Coding may proceed but RFC should be approved.`);
        }
      }
    }

    if (itemType === 'story' && nextStep === 'coding') {
      // Story → Coding: Should have design and RFC (warnings if missing)
      const traceability = await this.getStoryTraceability(itemId);
      if (!traceability.designs || traceability.designs.length === 0) {
        warnings.push('Story has no linked design. Coding may proceed but design context is missing.');
      }
      if (!traceability.rfc) {
        warnings.push('Story has no linked RFC. Coding may proceed but technical specifications are missing.');
      }
    }

    return {
      valid: missing.length === 0,
      missing,
      warnings
    };
  }

  /**
   * Get missing items at a specific step
   */
  async getMissingItems(projectId: string, step: 'prd' | 'stories' | 'design' | 'rfc' | 'breakdown' | 'coding'): Promise<Array<{ id: string; title: string; reason: string }>> {
    const completeness = await this.checkProjectCompleteness(projectId);
    const missing: Array<{ id: string; title: string; reason: string }> = [];

    switch (step) {
      case 'prd':
        if (!completeness.prd.exists) {
          missing.push({ id: '', title: 'PRD', reason: 'No PRD document exists for this project' });
        }
        break;

      case 'stories':
        completeness.stories.without_prd.forEach(s => {
          missing.push({ id: s.id, title: s.title, reason: 'Story is not linked to PRD' });
        });
        break;

      case 'design':
        completeness.stories.without_design.forEach(s => {
          missing.push({ id: s.id, title: s.title, reason: 'Story has no linked user flow (design)' });
        });
        completeness.designs.without_stories.forEach(d => {
          missing.push({ id: d.id, title: d.flow_name, reason: 'User flow has no linked stories' });
        });
        break;

      case 'rfc':
        completeness.stories.without_rfc.forEach(s => {
          missing.push({ id: s.id, title: s.title, reason: 'Story has no linked RFC' });
        });
        completeness.designs.without_rfc.forEach(d => {
          missing.push({ id: d.id, title: d.flow_name, reason: 'User flow has no linked RFC' });
        });
        completeness.rfc.not_approved.forEach(r => {
          missing.push({ id: r.id, title: r.title, reason: `RFC is not approved (status: ${r.status})` });
        });
        break;

      case 'breakdown':
        completeness.rfc.without_breakdown.forEach(r => {
          missing.push({ id: r.id, title: r.title, reason: 'RFC has no breakdown (epic)' });
        });
        completeness.breakdowns.without_rfc.forEach(e => {
          missing.push({ id: e.id, title: e.title, reason: 'Epic has no RFC' });
        });
        break;

      case 'coding':
        completeness.stories.without_coding.forEach(s => {
          missing.push({ id: s.id, title: s.title, reason: 'Story has no coding session' });
        });
        completeness.breakdowns.without_coding.forEach(e => {
          missing.push({ id: e.id, title: e.title, reason: 'Epic has no coding sessions' });
        });
        break;
    }

    return missing;
  }

  /**
   * Get recommendations for next actions
   */
  async getRecommendations(projectId: string): Promise<Array<{ action: string; priority: 'high' | 'medium' | 'low'; items: Array<{ id: string; title: string }> }>> {
    const completeness = await this.checkProjectCompleteness(projectId);
    const recommendations: Array<{ action: string; priority: 'high' | 'medium' | 'low'; items: Array<{ id: string; title: string }> }> = [];

    // High priority: Missing PRD
    if (!completeness.prd.exists) {
      recommendations.push({
        action: 'Create PRD document',
        priority: 'high',
        items: [{ id: '', title: 'PRD' }]
      });
    }

    // High priority: Stories without PRD
    if (completeness.stories.without_prd.length > 0) {
      recommendations.push({
        action: 'Link stories to PRD',
        priority: 'high',
        items: completeness.stories.without_prd
      });
    }

    // Medium priority: Stories without design
    if (completeness.stories.without_design.length > 0) {
      recommendations.push({
        action: 'Generate user flows for stories',
        priority: 'medium',
        items: completeness.stories.without_design
      });
    }

    // Medium priority: Designs without RFC
    if (completeness.designs.without_rfc.length > 0) {
      recommendations.push({
        action: 'Generate RFC for user flows',
        priority: 'medium',
        items: completeness.designs.without_rfc.map(d => ({ id: d.id, title: d.flow_name }))
      });
    }

    // High priority: RFCs not approved
    if (completeness.rfc.not_approved.length > 0) {
      recommendations.push({
        action: 'Approve RFCs before breakdown',
        priority: 'high',
        items: completeness.rfc.not_approved.map(r => ({ id: r.id, title: r.title }))
      });
    }

    // Medium priority: RFCs without breakdown
    if (completeness.rfc.without_breakdown.length > 0) {
      recommendations.push({
        action: 'Generate breakdown for approved RFCs',
        priority: 'medium',
        items: completeness.rfc.without_breakdown
      });
    }

    // Low priority: Stories without coding
    if (completeness.stories.without_coding.length > 0) {
      recommendations.push({
        action: 'Start coding sessions for stories',
        priority: 'low',
        items: completeness.stories.without_coding
      });
    }

    return recommendations;
  }
}

