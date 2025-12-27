/**
 * Test: Traceability Validation Prevents Invalid Operations
 * 
 * This test verifies that the traceability validation correctly prevents
 * creating items without required prerequisites.
 * 
 * TODO 24: Test traceability validation prevents creating items without prerequisites
 */

import { TraceabilityService } from '../src/services/traceabilityService';
import { TaskRepository } from '../src/repositories/taskRepository';
import { PRDRepository } from '../src/repositories/prdRepository';
import { RFCRepository } from '../src/repositories/rfcRepository';
import { EpicRepository } from '../src/repositories/epicRepository';
import { UserFlowRepository } from '../src/repositories/userFlowRepository';

// Mock repositories for testing
jest.mock('../src/repositories/taskRepository');
jest.mock('../src/repositories/prdRepository');
jest.mock('../src/repositories/rfcRepository');
jest.mock('../src/repositories/epicRepository');
jest.mock('../src/repositories/userFlowRepository');

describe('Traceability Validation', () => {
  let traceabilityService: TraceabilityService;

  beforeEach(() => {
    traceabilityService = new TraceabilityService();
    jest.clearAllMocks();
  });

  describe('Story → Design Validation', () => {
    it('should require PRD before creating design for story', async () => {
      const taskRepo = new TaskRepository();
      
      // Mock story without PRD
      (taskRepo.findById as jest.Mock).mockResolvedValue({
        id: 'story-1',
        title: 'Test Story',
        prd_id: null
      });

      traceabilityService = new TraceabilityService(taskRepo);
      const validation = await traceabilityService.validateCanProceed(
        'story-1',
        'story',
        'design'
      );

      expect(validation.valid).toBe(false);
      expect(validation.missing).toContain('Story must be linked to a PRD');
    });

    it('should allow design creation when story has PRD', async () => {
      const taskRepo = new TaskRepository();
      
      // Mock story with PRD
      (taskRepo.findById as jest.Mock).mockResolvedValue({
        id: 'story-1',
        title: 'Test Story',
        prd_id: 'prd-1'
      });

      traceabilityService = new TraceabilityService(taskRepo);
      const validation = await traceabilityService.validateCanProceed(
        'story-1',
        'story',
        'design'
      );

      expect(validation.valid).toBe(true);
      expect(validation.missing.length).toBe(0);
    });
  });

  describe('Story → RFC Validation', () => {
    it('should warn when story has no design before RFC', async () => {
      const taskRepo = new TaskRepository();
      const { TraceabilityRepository } = await import('../src/repositories/traceabilityRepository');
      const traceRepo = new TraceabilityRepository();
      
      (taskRepo.findById as jest.Mock).mockResolvedValue({
        id: 'story-1',
        title: 'Test Story'
      });

      (traceRepo.getStoryTraceability as jest.Mock) = jest.fn().mockResolvedValue({
        story: { id: 'story-1' },
        designs: []
      });

      traceabilityService = new TraceabilityService(taskRepo, undefined, undefined, undefined, undefined, undefined, traceRepo);
      const validation = await traceabilityService.validateCanProceed(
        'story-1',
        'story',
        'rfc'
      );

      expect(validation.valid).toBe(true); // RFC can proceed without design
      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(validation.warnings.some(w => w.includes('no linked design'))).toBe(true);
    });
  });

  describe('RFC → Breakdown Validation', () => {
    it('should require RFC to be approved before breakdown', async () => {
      const rfcRepo = new RFCRepository();
      
      // Mock RFC with status 'draft'
      (rfcRepo.findById as jest.Mock).mockResolvedValue({
        id: 'rfc-1',
        title: 'Test RFC',
        status: 'draft'
      });

      traceabilityService = new TraceabilityService(undefined, undefined, undefined, rfcRepo);
      const validation = await traceabilityService.validateCanProceed(
        'rfc-1',
        'rfc',
        'breakdown'
      );

      expect(validation.valid).toBe(false);
      expect(validation.missing.some(m => m.includes('must be approved'))).toBe(true);
    });

    it('should allow breakdown when RFC is approved', async () => {
      const rfcRepo = new RFCRepository();
      
      // Mock RFC with status 'approved'
      (rfcRepo.findById as jest.Mock).mockResolvedValue({
        id: 'rfc-1',
        title: 'Test RFC',
        status: 'approved'
      });

      traceabilityService = new TraceabilityService(undefined, undefined, undefined, rfcRepo);
      const validation = await traceabilityService.validateCanProceed(
        'rfc-1',
        'rfc',
        'breakdown'
      );

      expect(validation.valid).toBe(true);
      expect(validation.missing.length).toBe(0);
    });
  });

  describe('Epic → Coding Validation', () => {
    it('should require RFC before coding epic', async () => {
      const epicRepo = new EpicRepository();
      
      // Mock epic without RFC
      (epicRepo.findById as jest.Mock).mockResolvedValue({
        id: 'epic-1',
        title: 'Test Epic',
        rfc_id: null
      });

      traceabilityService = new TraceabilityService(undefined, undefined, undefined, undefined, epicRepo);
      const validation = await traceabilityService.validateCanProceed(
        'epic-1',
        'epic',
        'coding'
      );

      expect(validation.valid).toBe(false);
      expect(validation.missing).toContain('Epic must have an RFC before coding');
    });

    it('should warn when epic RFC is not approved', async () => {
      const epicRepo = new EpicRepository();
      const rfcRepo = new RFCRepository();
      
      // Mock epic with RFC
      (epicRepo.findById as jest.Mock).mockResolvedValue({
        id: 'epic-1',
        title: 'Test Epic',
        rfc_id: 'rfc-1'
      });

      // Mock RFC with status 'draft'
      (rfcRepo.findById as jest.Mock).mockResolvedValue({
        id: 'rfc-1',
        title: 'Test RFC',
        status: 'draft'
      });

      traceabilityService = new TraceabilityService(undefined, undefined, undefined, rfcRepo, epicRepo);
      const validation = await traceabilityService.validateCanProceed(
        'epic-1',
        'epic',
        'coding'
      );

      expect(validation.valid).toBe(true); // Coding can proceed but with warning
      expect(validation.warnings.length).toBeGreaterThan(0);
      expect(validation.warnings.some(w => w.includes('not approved'))).toBe(true);
    });

    it('should allow coding when epic has approved RFC', async () => {
      const epicRepo = new EpicRepository();
      const rfcRepo = new RFCRepository();
      
      // Mock epic with RFC
      (epicRepo.findById as jest.Mock).mockResolvedValue({
        id: 'epic-1',
        title: 'Test Epic',
        rfc_id: 'rfc-1'
      });

      // Mock RFC with status 'approved'
      (rfcRepo.findById as jest.Mock).mockResolvedValue({
        id: 'rfc-1',
        title: 'Test RFC',
        status: 'approved'
      });

      traceabilityService = new TraceabilityService(undefined, undefined, undefined, rfcRepo, epicRepo);
      const validation = await traceabilityService.validateCanProceed(
        'epic-1',
        'epic',
        'coding'
      );

      expect(validation.valid).toBe(true);
      expect(validation.missing.length).toBe(0);
      expect(validation.warnings.length).toBe(0);
    });
  });

  describe('Story → Coding Validation', () => {
    it('should warn when story has no design before coding', async () => {
      // Mock traceability with no design
      const traceability = {
        story: { id: 'story-1' },
        designs: [],
        rfc: null
      };

      // Mock getStoryTraceability
      jest.spyOn(traceabilityService, 'getStoryTraceability').mockResolvedValue(traceability as any);

      const validation = await traceabilityService.validateCanProceed(
        'story-1',
        'story',
        'coding'
      );

      expect(validation.valid).toBe(true); // Coding can proceed
      expect(validation.warnings.some(w => w.includes('no linked design'))).toBe(true);
    });

    it('should warn when story has no RFC before coding', async () => {
      // Mock traceability with design but no RFC
      const traceability = {
        story: { id: 'story-1' },
        designs: [{ id: 'design-1' }],
        rfc: null
      };

      jest.spyOn(traceabilityService, 'getStoryTraceability').mockResolvedValue(traceability as any);

      const validation = await traceabilityService.validateCanProceed(
        'story-1',
        'story',
        'coding'
      );

      expect(validation.valid).toBe(true); // Coding can proceed
      expect(validation.warnings.some(w => w.includes('no linked RFC'))).toBe(true);
    });

    it('should allow coding when story has both design and RFC', async () => {
      // Mock traceability with both design and RFC
      const traceability = {
        story: { id: 'story-1' },
        designs: [{ id: 'design-1' }],
        rfc: { id: 'rfc-1', status: 'approved' }
      };

      jest.spyOn(traceabilityService, 'getStoryTraceability').mockResolvedValue(traceability as any);

      const validation = await traceabilityService.validateCanProceed(
        'story-1',
        'story',
        'coding'
      );

      expect(validation.valid).toBe(true);
      expect(validation.warnings.length).toBe(0);
    });
  });
});

