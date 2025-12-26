import pool from '../config/database';
import { RFCDocument, CreateRFCRequest, UpdateRFCRequest } from '@devflow-studio/shared';

export class RFCRepository {
  async findByProjectId(projectId: string): Promise<RFCDocument[]> {
    const result = await pool.query(
      'SELECT * FROM rfc_documents WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    return result.rows.map((row: any) => this.mapRowToRFC(row));
  }

  async findById(id: string): Promise<RFCDocument | null> {
    const result = await pool.query(
      'SELECT * FROM rfc_documents WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRowToRFC(result.rows[0]) : null;
  }

  async create(data: CreateRFCRequest & { user_flow_id?: string }): Promise<RFCDocument> {
    try {
      // Check if user_flow_id column exists
      const columnCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'rfc_documents' 
          AND column_name = 'user_flow_id'
        )
      `);
      
      const hasUserFlowIdColumn = columnCheck.rows[0].exists;
      
      let result;
      if (hasUserFlowIdColumn && data.user_flow_id) {
        // Include user_flow_id in INSERT
        result = await pool.query(
          `INSERT INTO rfc_documents (project_id, title, content, architecture_type, status, user_flow_id)
           VALUES ($1, $2, $3, $4, 'draft', $5)
           RETURNING *`,
          [data.project_id, data.title, data.content, data.architecture_type || null, data.user_flow_id]
        );
      } else {
        // Fallback: INSERT without user_flow_id (migration 014 not applied)
        if (data.user_flow_id && !hasUserFlowIdColumn) {
          console.warn(`[RFCRepository] ⚠️ user_flow_id column not found. Migration 014 may not be applied. Creating RFC without user flow link.`);
        }
        result = await pool.query(
          `INSERT INTO rfc_documents (project_id, title, content, architecture_type, status)
           VALUES ($1, $2, $3, $4, 'draft')
           RETURNING *`,
          [data.project_id, data.title, data.content, data.architecture_type || null]
        );
      }
      
      return this.mapRowToRFC(result.rows[0]);
    } catch (error: any) {
      console.error('[RFCRepository] Error creating RFC:', error);
      console.error('[RFCRepository] Error details:', {
        message: error.message,
        code: error.code,
        detail: error.detail,
        constraint: error.constraint
      });
      throw error;
    }
  }

  async update(id: string, data: UpdateRFCRequest): Promise<RFCDocument | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }
    if (data.content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(data.content);
    }
    if (data.architecture_type !== undefined) {
      updates.push(`architecture_type = $${paramIndex++}`);
      values.push(data.architecture_type);
    }
    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(data.status);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE rfc_documents SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
    return result.rows[0] ? this.mapRowToRFC(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM rfc_documents WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  private mapRowToRFC(row: any): RFCDocument {
    return {
      id: row.id,
      project_id: row.project_id,
      title: row.title,
      content: row.content,
      architecture_type: row.architecture_type,
      status: row.status,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}
