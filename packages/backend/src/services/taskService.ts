import { TaskRepository } from '../repositories/taskRepository';
import { CreateTaskRequest, UpdateTaskRequest, Task, TaskType } from '@devflow-studio/shared';

export class TaskService {
  private taskRepo: TaskRepository;

  constructor() {
    this.taskRepo = new TaskRepository();
  }

  async getTasksByProject(projectId: string): Promise<Task[]> {
    return await this.taskRepo.findByProjectId(projectId);
  }

  async getTasksByProjectAndType(projectId: string, type: TaskType): Promise<Task[]> {
    return await this.taskRepo.findByProjectIdAndType(projectId, type);
  }

  async getTaskById(id: string): Promise<Task | null> {
    return await this.taskRepo.findById(id);
  }

  async createTask(data: CreateTaskRequest): Promise<Task> {
    return await this.taskRepo.create(data);
  }

  async updateTask(id: string, data: UpdateTaskRequest): Promise<Task | null> {
    return await this.taskRepo.update(id, data);
  }

  async deleteTask(id: string): Promise<boolean> {
    return await this.taskRepo.delete(id);
  }
}

