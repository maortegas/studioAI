import { RFCRepository } from '../repositories/rfcRepository';
import { APIContractRepository } from '../repositories/apiContractRepository';
import { DatabaseSchemaRepository } from '../repositories/databaseSchemaRepository';
import { PRDService } from './prdService';
import { TaskRepository } from '../repositories/taskRepository';
import { ProjectRepository } from '../repositories/projectRepository';
import { AIService } from './aiService';
import { GenerateRFCRequest, RFCDocument, APIContract, DatabaseSchema } from '@devflow-studio/shared';
import { createFile, ensureDirectory } from '../utils/fileSystem';
import * as path from 'path';

export class RFCGeneratorService {
  private rfcRepo: RFCRepository;
  private apiContractRepo: APIContractRepository;
  private dbSchemaRepo: DatabaseSchemaRepository;
  private prdService: PRDService;
  private taskRepo: TaskRepository;
  private projectRepo: ProjectRepository;
  private aiService: AIService;

  constructor() {
    this.rfcRepo = new RFCRepository();
    this.apiContractRepo = new APIContractRepository();
    this.dbSchemaRepo = new DatabaseSchemaRepository();
    this.prdService = new PRDService();
    this.taskRepo = new TaskRepository();
    this.projectRepo = new ProjectRepository();
    this.aiService = new AIService();
  }

  /**
   * Generate RFC document from PRD and User Stories
   */
  async generateRFC(request: GenerateRFCRequest): Promise<{ rfc_id: string; job_id: string }> {
    // Get PRD
    const prd = await this.prdService.getPRDById(request.prd_id);
    if (!prd) {
      throw new Error('PRD not found');
    }

    // Get User Stories
    const allStories = await this.taskRepo.findByProjectIdAndType(request.project_id, 'story');
    let stories = allStories;
    
    // Filter by story_ids if provided
    if (request.story_ids && request.story_ids.length > 0) {
      stories = allStories.filter(story => request.story_ids!.includes(story.id));
    }

    if (stories.length === 0) {
      throw new Error('No user stories found. Generate stories from PRD first.');
    }

    // Get project info
    const project = await this.projectRepo.findById(request.project_id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Build prompt for RFC generation
    const prompt = this.buildRFCGenerationPrompt(prd, stories, project, request.options);

    // Create AI job
    const aiJob = await this.aiService.createAIJob({
      project_id: request.project_id,
      provider: 'cursor',
      mode: 'agent',
      prompt,
    } as any, {
      prd_id: request.prd_id,
      phase: 'rfc_generation',
      include_diagrams: request.options?.include_diagrams ?? true,
      include_api_contracts: request.options?.include_api_contracts ?? true,
      include_database_schema: request.options?.include_database_schema ?? true,
      architecture_type: request.options?.architecture_type,
      skipBundle: true,
    });

    // Create RFC document placeholder (will be updated by worker)
    const rfcTitle = `RFC: ${project.name} - Technical Design`;
    const rfc = await this.rfcRepo.create({
      project_id: request.project_id,
      title: rfcTitle,
      content: '# RFC: Technical Design\n\n*Generating...*',
      architecture_type: request.options?.architecture_type,
    });

    // Update AI job args to include rfc_id
    const poolModule = await import('../config/database');
    const pool = poolModule.default as any;
    await pool.query(
      `UPDATE ai_jobs SET args = args || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ rfc_id: rfc.id }), aiJob.id]
    );

    // Return RFC ID and job ID
    return {
      rfc_id: rfc.id,
      job_id: aiJob.id,
    };
  }

  /**
   * Build prompt for RFC generation
   */
  private buildRFCGenerationPrompt(
    prd: any,
    stories: any[],
    project: any,
    options?: GenerateRFCRequest['options']
  ): string {
    const lines: string[] = [];

    lines.push('# Generate RFC (Request for Comments) / Technical Design Document');
    lines.push('');
    lines.push('## PRD Context');
    lines.push('');
    lines.push('### Vision');
    lines.push(prd.vision);
    lines.push('');
    lines.push('### User Personas');
    prd.personas.forEach((persona: any, index: number) => {
      lines.push(`#### Persona ${index + 1}: ${persona.role}`);
      lines.push(`- **Needs**: ${persona.needs.join(', ')}`);
      lines.push(`- **Goals**: ${persona.goals.join(', ')}`);
      lines.push('');
    });

    lines.push('---');
    lines.push('');
    lines.push('## User Stories');
    lines.push('');
    stories.forEach((story, index) => {
      lines.push(`### Story ${index + 1}: ${story.title}`);
      if (story.description) {
        lines.push(story.description);
      }
      if (story.acceptance_criteria) {
        const ac = typeof story.acceptance_criteria === 'string' 
          ? JSON.parse(story.acceptance_criteria) 
          : story.acceptance_criteria;
        if (Array.isArray(ac) && ac.length > 0) {
          lines.push('');
          lines.push('**Acceptance Criteria:**');
          ac.forEach((criterion: any) => {
            const acText = typeof criterion === 'string' ? criterion : criterion.criterion;
            lines.push(`- ${acText}`);
          });
        }
      }
      lines.push('');
    });

    lines.push('---');
    lines.push('');
    lines.push('## Instructions');
    lines.push('');
    lines.push('Generate a comprehensive RFC (Request for Comments) / Technical Design Document that defines the system architecture, API contracts, and database schema for the project described above.');
    lines.push('');
    lines.push('### Required Sections');
    lines.push('');
    lines.push('1. **Overview**: High-level summary of the system');
    lines.push('2. **Architecture Decision**: Choose between:');
    lines.push('   - Monorepo (recommended for this project)');
    lines.push('   - Polyrepo');
    lines.push('   - Microservices');
    lines.push('   - Monolithic');
    lines.push('   - Serverless');
    lines.push('   Explain the reasoning based on project requirements.');
    lines.push('');
    lines.push('3. **System Architecture**:');
    lines.push('   - Overall system design');
    lines.push('   - Component breakdown');
    lines.push('   - Technology stack recommendations');
    lines.push('   - If diagrams are requested, include Mermaid.js sequence diagrams');
    lines.push('');
    lines.push('4. **API Design**:');
    lines.push('   - RESTful endpoints or GraphQL schema');
    lines.push('   - Request/Response formats');
    lines.push('   - Authentication and authorization');
    lines.push('   - If API contracts are requested, provide OpenAPI/Swagger specification');
    lines.push('');
    lines.push('5. **Database Schema**:');
    lines.push('   - Entity Relationship Model');
    lines.push('   - Table definitions with fields and types');
    lines.push('   - Relationships and constraints');
    lines.push('   - If database schema is requested, provide SQL DDL or NoSQL schema definitions');
    lines.push('');
    lines.push('6. **Data Flow**:');
    lines.push('   - How data flows through the system');
    lines.push('   - Key data transformations');
    lines.push('');
    lines.push('7. **Security Considerations**:');
    lines.push('   - Authentication strategy');
    lines.push('   - Authorization model');
    lines.push('   - Data protection');
    lines.push('');
    lines.push('8. **Deployment Architecture**:');
    lines.push('   - Infrastructure requirements');
    lines.push('   - Deployment strategy');
    lines.push('   - Scalability considerations');
    lines.push('');

    if (options?.include_diagrams) {
      lines.push('### Diagrams (Mermaid.js)');
      lines.push('');
      lines.push('Include sequence diagrams for key user flows. Use Mermaid.js format:');
      lines.push('```mermaid');
      lines.push('sequenceDiagram');
      lines.push('    participant User');
      lines.push('    participant API');
      lines.push('    participant DB');
      lines.push('    User->>API: Request');
      lines.push('    API->>DB: Query');
      lines.push('    DB-->>API: Response');
      lines.push('    API-->>User: Response');
      lines.push('```');
      lines.push('');
    }

    if (options?.include_api_contracts) {
      lines.push('### API Contracts');
      lines.push('');
      lines.push('Provide OpenAPI/Swagger specification in JSON format. Include all endpoints needed to support the user stories.');
      lines.push('');
    }

    if (options?.include_database_schema) {
      lines.push('### Database Schema');
      lines.push('');
      lines.push('Provide complete SQL DDL statements or NoSQL schema definitions for all entities.');
      lines.push('');
    }

    lines.push('### Output Format');
    lines.push('');
    lines.push('The RFC should be provided as a Markdown document. If diagrams, API contracts, or database schemas are requested, include them in separate sections within the markdown.');
    lines.push('');
    lines.push('**CRITICAL**: Start your response directly with the RFC markdown content. Do not include any introductory text before the markdown.');

    return lines.join('\n');
  }

  /**
   * Get RFC by ID
   */
  async getRFCById(id: string): Promise<RFCDocument | null> {
    return await this.rfcRepo.findById(id);
  }

  /**
   * Get all RFCs for a project
   */
  async getRFCsByProject(projectId: string): Promise<RFCDocument[]> {
    return await this.rfcRepo.findByProjectId(projectId);
  }

  /**
   * Get API contracts for an RFC
   */
  async getAPIContracts(rfcId: string): Promise<APIContract[]> {
    return await this.apiContractRepo.findByRFCId(rfcId);
  }

  /**
   * Get database schemas for an RFC
   */
  async getDatabaseSchemas(rfcId: string): Promise<DatabaseSchema[]> {
    return await this.dbSchemaRepo.findByRFCId(rfcId);
  }

  /**
   * Save RFC to filesystem
   */
  async saveRFCToFilesystem(projectBasePath: string, projectId: string, rfc: RFCDocument): Promise<void> {
    const rfcDir = path.join(projectBasePath, 'docs', 'rfc', projectId);
    await ensureDirectory(rfcDir);

    // Save RFC markdown
    const rfcPath = path.join(rfcDir, `rfc-${rfc.id}.md`);
    await createFile(rfcPath, rfc.content);

    // Save API contracts if they exist
    const contracts = await this.apiContractRepo.findByRFCId(rfc.id);
    if (contracts.length > 0) {
      const contractsDir = path.join(rfcDir, 'api-contracts');
      await ensureDirectory(contractsDir);
      
      for (const contract of contracts) {
        const contractPath = path.join(contractsDir, `contract-${contract.id}.${contract.contract_type === 'openapi' || contract.contract_type === 'swagger' ? 'json' : 'graphql'}`);
        const contractContent = typeof contract.contract_content === 'string'
          ? contract.contract_content
          : JSON.stringify(contract.contract_content, null, 2);
        await createFile(contractPath, contractContent);
      }
    }

    // Save database schemas if they exist
    const schemas = await this.dbSchemaRepo.findByRFCId(rfc.id);
    if (schemas.length > 0) {
      const schemasDir = path.join(rfcDir, 'database-schemas');
      await ensureDirectory(schemasDir);
      
      for (const schema of schemas) {
        const schemaPath = path.join(schemasDir, `schema-${schema.id}.${schema.schema_type === 'sql' ? 'sql' : 'json'}`);
        await createFile(schemaPath, schema.schema_content);
      }
    }
  }
}
