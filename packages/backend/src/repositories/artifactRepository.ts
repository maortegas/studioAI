import pool from '../config/database';
import { Artifact, CreateArtifactRequest, ArtifactType } from '@devflow-studio/shared';

export class ArtifactRepository {
  async findByProjectId(projectId: string): Promise<Artifact[]> {
    const result = await pool.query(
      'SELECT * FROM artifacts WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    return result.rows;
  }

  async findByProjectIdAndType(projectId: string, type: ArtifactType): Promise<Artifact | null> {
    const result = await pool.query(
      'SELECT * FROM artifacts WHERE project_id = $1 AND type = $2 ORDER BY created_at DESC LIMIT 1',
      [projectId, type]
    );
    return result.rows[0] || null;
  }

  async findById(id: string): Promise<Artifact | null> {
    const result = await pool.query('SELECT * FROM artifacts WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async create(data: CreateArtifactRequest): Promise<Artifact> {
    const result = await pool.query(
      `INSERT INTO artifacts (project_id, type, path, content)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.project_id, data.type, data.path, JSON.stringify(data.content)]
    );
    return result.rows[0];
  }

  async update(id: string, content: Record<string, any>): Promise<Artifact | null> {
    const result = await pool.query(
      `UPDATE artifacts SET content = $1 WHERE id = $2 RETURNING *`,
      [JSON.stringify(content), id]
    );
    return result.rows[0] || null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM artifacts WHERE id = $1', [id]);
    return result.rowCount > 0;
  }
}

