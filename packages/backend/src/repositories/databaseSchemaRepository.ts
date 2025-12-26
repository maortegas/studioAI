import pool from '../config/database';
import { DatabaseSchema } from '@devflow-studio/shared';

export class DatabaseSchemaRepository {
  async findByRFCId(rfcId: string): Promise<DatabaseSchema[]> {
    const result = await pool.query(
      'SELECT * FROM database_schemas WHERE rfc_id = $1 ORDER BY created_at DESC',
      [rfcId]
    );
    return result.rows.map(row => this.mapRowToSchema(row));
  }

  async findById(id: string): Promise<DatabaseSchema | null> {
    const result = await pool.query(
      'SELECT * FROM database_schemas WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRowToSchema(result.rows[0]) : null;
  }

  async create(data: {
    rfc_id: string;
    schema_type: string;
    schema_content: string;
    migrations_path?: string;
  }): Promise<DatabaseSchema> {
    const result = await pool.query(
      `INSERT INTO database_schemas (rfc_id, schema_type, schema_content, migrations_path)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        data.rfc_id,
        data.schema_type,
        data.schema_content,
        data.migrations_path || null,
      ]
    );
    return this.mapRowToSchema(result.rows[0]);
  }

  async update(id: string, data: Partial<{
    schema_content: string;
    migrations_path: string;
  }>): Promise<DatabaseSchema | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.schema_content !== undefined) {
      updates.push(`schema_content = $${paramIndex++}`);
      values.push(data.schema_content);
    }
    if (data.migrations_path !== undefined) {
      updates.push(`migrations_path = $${paramIndex++}`);
      values.push(data.migrations_path);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE database_schemas SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
    return result.rows[0] ? this.mapRowToSchema(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM database_schemas WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  private mapRowToSchema(row: any): DatabaseSchema {
    return {
      id: row.id,
      rfc_id: row.rfc_id,
      schema_type: row.schema_type,
      schema_content: row.schema_content,
      migrations_path: row.migrations_path,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}
