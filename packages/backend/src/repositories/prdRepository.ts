import pool from '../config/database';
import { PRDDocument, CreatePRDRequest, UpdatePRDRequest } from '@devflow-studio/shared';

export class PRDRepository {
  async findByProjectId(projectId: string): Promise<PRDDocument | null> {
    const result = await pool.query(
      'SELECT * FROM prd_documents WHERE project_id = $1',
      [projectId]
    );
    return result.rows[0] ? this.mapRowToPRD(result.rows[0]) : null;
  }

  async findById(id: string): Promise<PRDDocument | null> {
    const result = await pool.query(
      'SELECT * FROM prd_documents WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRowToPRD(result.rows[0]) : null;
  }

  async create(data: CreatePRDRequest): Promise<PRDDocument> {
    const result = await pool.query(
      `INSERT INTO prd_documents (project_id, vision, personas, status)
       VALUES ($1, $2, $3, 'draft')
       RETURNING *`,
      [data.project_id, data.vision, JSON.stringify(data.personas)]
    );
    return this.mapRowToPRD(result.rows[0]);
  }

  async update(id: string, data: UpdatePRDRequest): Promise<PRDDocument | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.vision !== undefined) {
      updates.push(`vision = $${paramIndex++}`);
      values.push(data.vision);
    }
    if (data.personas !== undefined) {
      updates.push(`personas = $${paramIndex++}`);
      values.push(JSON.stringify(data.personas));
    }
    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(data.status);
      if (data.status === 'validated') {
        updates.push(`validated_at = NOW()`);
      }
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE prd_documents SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
    return result.rows[0] ? this.mapRowToPRD(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM prd_documents WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  private mapRowToPRD(row: any): PRDDocument {
    return {
      id: row.id,
      project_id: row.project_id,
      vision: row.vision,
      personas: typeof row.personas === 'string' ? JSON.parse(row.personas) : row.personas,
      status: row.status,
      validated_at: row.validated_at ? new Date(row.validated_at) : undefined,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}
