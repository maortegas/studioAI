import { Router, Request, Response } from 'express';
import { ArtifactService } from '../services/artifactService';
import multer from 'multer';
import { CreateArtifactRequest } from '@devflow-studio/shared';

const router = Router();
const artifactService = new ArtifactService();

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

router.get('/project/:projectId', async (req: Request, res: Response) => {
  try {
    const artifacts = await artifactService.getArtifactsByProject(req.params.projectId);
    res.json(artifacts);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const artifact = await artifactService.getArtifactById(req.params.id);
    if (!artifact) {
      return res.status(404).json({ error: 'Artifact not found' });
    }
    res.json(artifact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/content', async (req: Request, res: Response) => {
  try {
    const content = await artifactService.readArtifactFile(req.params.id);
    res.json({ content: content || '' });
  } catch (error: any) {
    // If artifact not found, return 404
    if (error.message === 'Artifact not found') {
      return res.status(404).json({ error: error.message });
    }
    // For file not found (ENOENT), return empty content instead of error
    if (error.code === 'ENOENT' || error.message.includes('ENOENT')) {
      return res.json({ content: '' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.post('/prd', async (req: Request, res: Response) => {
  try {
    const { project_id, content } = req.body;
    
    if (!project_id || !content) {
      return res.status(400).json({ error: 'project_id and content are required' });
    }

    const artifact = await artifactService.savePRD(project_id, content);
    res.status(201).json(artifact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/architecture', async (req: Request, res: Response) => {
  try {
    const { project_id, content } = req.body;
    
    if (!project_id || !content) {
      return res.status(400).json({ error: 'project_id and content are required' });
    }

    const artifact = await artifactService.saveArchitecture(project_id, content);
    res.status(201).json(artifact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/architecture/generate', async (req: Request, res: Response) => {
  try {
    const { project_id } = req.body;
    
    if (!project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    // Import required services and repositories
    const { AIService } = await import('../services/aiService');
    const { ProjectRepository } = await import('../repositories/projectRepository');
    const { TaskRepository } = await import('../repositories/taskRepository');
    
    const aiService = new AIService();
    const projectRepo = new ProjectRepository();
    const taskRepo = new TaskRepository();
    
    // Get project to access tech_stack
    const project = await projectRepo.findById(project_id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    // Get all user stories for explicit reference
    const userStories = await taskRepo.findByProjectIdAndType(project_id, 'story');
    
    // Build prompt bundle which includes PRD COMPLETO (idea del proyecto)
    const promptBundle = await aiService.buildPromptBundle(project_id);
    
    // Verify PRD is included - critical for architecture generation
    if (!promptBundle.includes('Product Requirements Document') && !promptBundle.includes('PRD')) {
      return res.status(400).json({ 
        error: 'PRD (Product Requirements Document) is required for architecture generation. Please create the PRD first.' 
      });
    }
    
    // Build technology stack constraints section
    let techStackSection = '';
    if (project.tech_stack) {
      techStackSection = `
## ⚠️ CRITICAL: TECHNOLOGY STACK CONSTRAINT

**MANDATORY TECHNOLOGY STACK (Defined at Project Creation):**
${project.tech_stack}

**STRICT RULES:**
1. You MUST use ONLY the technologies specified in the stack above: "${project.tech_stack}"
2. DO NOT invent, suggest, or add technologies that are NOT in the defined stack
3. DO NOT use alternative technologies or frameworks unless explicitly mentioned in the stack
4. If the stack specifies a database (e.g., PostgreSQL, MySQL, MongoDB), use ONLY that database
5. If the stack specifies a framework (e.g., React, Vue, Angular), use ONLY that framework
6. If the stack specifies a language (e.g., TypeScript, Python, Java), use ONLY that language
7. All libraries, tools, and dependencies MUST be compatible with the defined stack
8. If you need to make assumptions about specific versions or tools, clearly state them but ensure they align with the stack

**If the stack is incomplete or ambiguous, you may suggest compatible additions, but they MUST be clearly marked as "suggestions" and must be compatible with the existing stack.**

`;
    } else {
      techStackSection = `
## ⚠️ TECHNOLOGY STACK NOT DEFINED

**WARNING:** No technology stack was defined for this project. You should:
1. Suggest a complete, coherent technology stack based on the PRD requirements
2. Clearly mark all technology choices as "suggested" since they were not pre-defined
3. Provide rationale for each technology choice
4. Ensure all suggested technologies work well together

`;
    }
    
    // Build user stories reference section
    let userStoriesSection = '';
    if (userStories.length > 0) {
      // Helper function to extract user role, action, and benefit from title
      const extractStoryParts = (title: string) => {
        const match = title.match(/Yo como\s+([^,]+),\s*quiero\s+([^,]+),\s*para\s+(.+)/i);
        if (match) {
          return {
            user_role: match[1].trim(),
            action: match[2].trim(),
            benefit: match[3].trim()
          };
        }
        return { user_role: 'N/A', action: 'N/A', benefit: 'N/A' };
      };
      
      userStoriesSection = `
## 📋 USER STORIES REFERENCE (MANDATORY)

The architecture MUST support and enable ALL of the following user stories. Each story represents a functional requirement that the architecture must accommodate:

${userStories.map((story, index) => {
  const storyParts = extractStoryParts(story.title);
  const criteria = story.acceptance_criteria?.map((ac: any) => {
    if (typeof ac === 'string') {
      return `    - ${ac}`;
    }
    return `    - ${ac.criterion || ac}`;
  }).join('\n') || '    - (No acceptance criteria defined)';
  
  return `
### User Story ${index + 1}: ${story.title}
**User Role:** ${storyParts.user_role}
**Action:** ${storyParts.action}
**Benefit:** ${storyParts.benefit}
**Priority:** ${story.priority || 0}
**Description:** ${story.description || story.title}

**Acceptance Criteria:**
${criteria}
`;
}).join('\n')}

**ARCHITECTURE REQUIREMENT:** The architecture you design MUST explicitly show how it supports each of these user stories. For each major component or service, indicate which user stories it enables.

`;
    } else {
      userStoriesSection = `
## 📋 USER STORIES

**NOTE:** No user stories have been generated yet for this project. The architecture should be designed to be flexible enough to accommodate future user stories based on the PRD.

`;
    }
    
    // Build comprehensive architecture prompt with complete PRD, tech stack, and user stories
    const architecturePrompt = `${promptBundle}

${techStackSection}

${userStoriesSection}

# Architecture Generation Task

Based on the COMPLETE Product Requirements Document (PRD) above, the defined technology stack constraints, and ALL user stories listed above, generate comprehensive architecture documentation.

**CRITICAL REQUIREMENTS:**
1. The architecture MUST align with and support ALL requirements, objectives, constraints, and user needs described in the PRD
2. The architecture MUST use ONLY the technologies specified in the technology stack constraint (if defined)
3. The architecture MUST explicitly support and enable ALL user stories listed above
4. DO NOT invent technologies, frameworks, or tools that are not in the defined stack
5. If you need to make technology choices, they MUST be compatible with the defined stack

Generate the following sections:

## System Architecture Overview
- High-level system architecture
- Main components and their relationships
- System boundaries and interfaces
- **Explicit mapping to user stories:** For each major component, list which user stories it supports

## Technology Stack Details
${project.tech_stack ? 
  `- **MANDATORY STACK:** ${project.tech_stack}
- Specific versions and configurations for each technology in the stack
- Rationale for how each technology in the stack addresses project requirements` :
  `- Programming languages and frameworks (suggested based on PRD)
- Libraries and dependencies
- Development tools
- Infrastructure components
- **IMPORTANT:** Clearly mark all suggestions and provide rationale`}
- **DO NOT add technologies outside the defined stack**

## Component Architecture
- Detailed component breakdown
- Component responsibilities
- Component interactions and dependencies
- Data flow between components
- **User Story Mapping:** For each component, indicate which user stories it enables

## Data Flow Diagrams (in text/markdown format)
- User interactions flow (aligned with user stories)
- Data processing flow
- System integration flow
- **Traceability:** Show how data flows support specific user story requirements

## API Design (if applicable)
- API endpoints structure
- Request/response formats
- Authentication and authorization
- API versioning strategy
- **User Story Support:** Map API endpoints to user stories they enable

## Database Schema (if applicable)
- Database type: ${project.tech_stack ? 'MUST use the database specified in the tech stack' : 'Suggest based on requirements'}
- Entity relationships
- Key tables and fields
- Indexing strategy
- **Data Requirements:** Ensure schema supports all user story data needs

## Deployment Architecture
- Deployment environment
- Infrastructure requirements
- Scaling strategy
- Monitoring and logging
- **Technology Constraints:** All deployment tools must align with the defined stack

## Security Considerations
- Security threats and mitigations
- Authentication and authorization
- Data protection
- Compliance requirements
- **User Story Security:** Address security requirements for each user story

## Architecture Validation Checklist
Before finalizing, verify:
- [ ] All technologies used are in the defined stack (or clearly marked as compatible suggestions)
- [ ] Every user story is supported by at least one architectural component
- [ ] No technologies were invented that are not in the stack
- [ ] All components have clear responsibilities aligned with user stories
- [ ] Data flow supports all user story requirements

Format the output as a well-structured markdown document that can be saved directly to ARCHITECTURE.md.`;

    // Create AI job for architecture generation
    const job = await aiService.createAIJob({
      project_id,
      provider: 'cursor', // Default provider
      mode: 'plan',
      prompt: architecturePrompt,
    });

    res.json({ job_id: job.id, message: 'Architecture generation started' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/adr', async (req: Request, res: Response) => {
  try {
    const { project_id, content, adr_number } = req.body;
    
    if (!project_id || !content) {
      return res.status(400).json({ error: 'project_id and content are required' });
    }

    const artifact = await artifactService.saveADR(project_id, content, adr_number);
    res.status(201).json(artifact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/project/:projectId/adr', async (req: Request, res: Response) => {
  try {
    const adrs = await artifactService.getADRsByProject(req.params.projectId);
    res.json(adrs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/adr/generate', async (req: Request, res: Response) => {
  try {
    const { project_id, decision_context } = req.body;
    
    if (!project_id) {
      return res.status(400).json({ error: 'project_id is required' });
    }

    // Import AIService to generate ADR
    const { AIService } = await import('../services/aiService');
    const aiService = new AIService();
    
    // Build prompt bundle which includes PRD and Architecture
    const promptBundle = await aiService.buildPromptBundle(project_id);
    
    // Get existing ADRs to determine next number
    const existingADRs = await artifactService.getADRsByProject(project_id);
    const nextADRNumber = existingADRs.length + 1;
    
    // Build comprehensive ADR prompt
    const adrPrompt = `${promptBundle}

# Architectural Decision Record (ADR) Generation

Generate an ADR-${nextADRNumber.toString().padStart(3, '0')} based on the project context above.

${decision_context ? `## Decision Context\n${decision_context}\n\n` : ''}## ADR Template

Follow this ADR format:

# ADR-${nextADRNumber.toString().padStart(3, '0')}: [Title]

## Status
[Proposed | Accepted | Deprecated | Superseded]

## Context
[Describe the issue motivating this decision or change. This is the "why" of the decision.]

## Decision
[Describe the change that we're proposing or have agreed to implement. This is the "what" of the decision.]

## Consequences
[Describe the consequences, both positive and negative, of this decision. This is the "what happens" as a result of the decision.]

## Alternatives Considered
[List the alternatives that were considered, and why they were rejected.]

## Notes
[Any additional notes or considerations.]

Generate a complete, well-structured ADR that aligns with the project's architecture and requirements described in the PRD and Architecture documentation above.`;

    // Create AI job for ADR generation
    const job = await aiService.createAIJob({
      project_id,
      provider: 'cursor',
      mode: 'plan',
      prompt: adrPrompt,
    });

    res.json({ 
      job_id: job.id, 
      adr_number: nextADRNumber,
      message: 'ADR generation started' 
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/adr/:id', async (req: Request, res: Response) => {
  try {
    const deleted = await artifactService.deleteADR(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'ADR not found' });
    }
    res.json({ message: 'ADR deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const data: CreateArtifactRequest = req.body;
    
    if (!data.project_id || !data.type || !data.path) {
      return res.status(400).json({ error: 'project_id, type, and path are required' });
    }

    let fileContent: string | undefined;
    if (req.file) {
      const fs = require('fs');
      fileContent = fs.readFileSync(req.file.path, 'utf8');
      fs.unlinkSync(req.file.path); // Clean up temp file
    }

    const artifact = await artifactService.saveArtifact(data, fileContent);
    res.status(201).json(artifact);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
