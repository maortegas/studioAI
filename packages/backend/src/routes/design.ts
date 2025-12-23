import { Router, Request, Response } from 'express';
import { DesignService } from '../services/designService';
import { GenerateUserFlowRequest, AnalyzePrototypeRequest } from '@devflow-studio/shared';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs/promises';

const router = Router();
const designService = new DesignService();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const projectId = req.body.project_id;
    if (!projectId) {
      return cb(new Error('project_id is required'), '');
    }
    
    const uploadDir = path.join(process.cwd(), 'uploads', 'prototypes', projectId);
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    // Accept images only
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Helper to convert absolute path to relative path for storage in DB
function getRelativePath(absolutePath: string): string {
  const uploadsDir = path.join(process.cwd(), 'uploads');
  return path.relative(uploadsDir, absolutePath);
}

// Generate User Flow
router.post('/user-flows/generate', async (req: Request, res: Response) => {
  try {
    const data: GenerateUserFlowRequest = req.body;
    
    if (!data.project_id || !data.flow_name) {
      return res.status(400).json({ 
        error: 'project_id and flow_name are required' 
      });
    }

    const result = await designService.generateUserFlow(data);
    res.json(result);
  } catch (error: any) {
    console.error('Error generating user flow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user flows by project
router.get('/user-flows/project/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const flows = await designService.getUserFlowsByProject(projectId);
    res.json(flows);
  } catch (error: any) {
    console.error('Error fetching user flows:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user flow by ID
router.get('/user-flows/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const flow = await designService.getUserFlowById(id);
    if (!flow) {
      return res.status(404).json({ error: 'User flow not found' });
    }
    res.json(flow);
  } catch (error: any) {
    console.error('Error fetching user flow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload and analyze prototype
router.post('/prototypes/analyze', upload.single('prototype'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Prototype file is required' });
    }

    // Store relative path (from uploads directory)
    const relativePath = getRelativePath(req.file.path);
    const data: AnalyzePrototypeRequest = {
      project_id: req.body.project_id,
      file_path: relativePath,
      file_name: req.file.originalname,
    };

    if (!data.project_id) {
      // Clean up uploaded file
      await fs.unlink(req.file.path);
      return res.status(400).json({ error: 'project_id is required' });
    }

    const result = await designService.analyzePrototype(data);
    res.json(result);
  } catch (error: any) {
    console.error('Error analyzing prototype:', error);
    
    // Clean up uploaded file on error
    if (req.file) {
      try {
        await fs.unlink(req.file.path);
      } catch (unlinkError) {
        // Ignore cleanup errors
      }
    }
    
    res.status(500).json({ error: error.message });
  }
});

// Get prototypes by project
router.get('/prototypes/project/:projectId', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const prototypes = await designService.getPrototypesByProject(projectId);
    res.json(prototypes);
  } catch (error: any) {
    console.error('Error fetching prototypes:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get prototype by ID
router.get('/prototypes/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prototype = await designService.getPrototypeById(id);
    if (!prototype) {
      return res.status(404).json({ error: 'Prototype not found' });
    }
    res.json(prototype);
  } catch (error: any) {
    console.error('Error fetching prototype:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get prototype image (serve file)
router.get('/prototypes/:id/image', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prototype = await designService.getPrototypeById(id);
    if (!prototype) {
      return res.status(404).json({ error: 'Prototype not found' });
    }
    
    const imagePath = path.join(process.cwd(), 'uploads', prototype.file_path);
    res.sendFile(imagePath);
  } catch (error: any) {
    console.error('Error serving prototype image:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
