import pool from '../config/database';
import { Prototype, AnalyzePrototypeRequest } from '@devflow-studio/shared';

export class PrototypeRepository {
  async findByProjectId(projectId: string): Promise<Prototype[]> {
    const result = await pool.query(
      'SELECT * FROM prototypes WHERE project_id = $1 ORDER BY uploaded_at DESC',
      [projectId]
    );
    return result.rows.map((row: any) => this.mapRowToPrototype(row));
  }

  async findById(id: string): Promise<Prototype | null> {
    const result = await pool.query(
      'SELECT * FROM prototypes WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRowToPrototype(result.rows[0]) : null;
  }

  async create(data: AnalyzePrototypeRequest): Promise<Prototype> {
    const result = await pool.query(
      `INSERT INTO prototypes (project_id, file_path, file_name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [
        data.project_id,
        data.file_path,
        data.file_name,
      ]
    );
    return this.mapRowToPrototype(result.rows[0]);
  }

  async updateAnalysis(id: string, analysisResult: Prototype['analysis_result']): Promise<Prototype | null> {
    const result = await pool.query(
      `UPDATE prototypes 
       SET analysis_result = $1
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify(analysisResult), id]
    );
    return result.rows[0] ? this.mapRowToPrototype(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM prototypes WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  private mapRowToPrototype(row: any): Prototype {
    return {
      id: row.id,
      project_id: row.project_id,
      file_path: row.file_path,
      file_name: row.file_name,
      analysis_result: row.analysis_result ? JSON.parse(JSON.stringify(row.analysis_result)) : undefined,
      uploaded_at: new Date(row.uploaded_at),
    };
  }
}
