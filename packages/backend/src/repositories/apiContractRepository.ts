import pool from '../config/database';
import { APIContract } from '@devflow-studio/shared';

export class APIContractRepository {
  async findByRFCId(rfcId: string): Promise<APIContract[]> {
    const result = await pool.query(
      'SELECT * FROM api_contracts WHERE rfc_id = $1 ORDER BY created_at DESC',
      [rfcId]
    );
    return result.rows.map(row => this.mapRowToContract(row));
  }

  async findById(id: string): Promise<APIContract | null> {
    const result = await pool.query(
      'SELECT * FROM api_contracts WHERE id = $1',
      [id]
    );
    return result.rows[0] ? this.mapRowToContract(result.rows[0]) : null;
  }

  async create(data: {
    rfc_id: string;
    contract_type: string;
    contract_content: Record<string, any>;
    file_path?: string;
    version?: string;
  }): Promise<APIContract> {
    const result = await pool.query(
      `INSERT INTO api_contracts (rfc_id, contract_type, contract_content, file_path, version)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        data.rfc_id,
        data.contract_type,
        JSON.stringify(data.contract_content),
        data.file_path || null,
        data.version || null,
      ]
    );
    return this.mapRowToContract(result.rows[0]);
  }

  async update(id: string, data: Partial<{
    contract_content: Record<string, any>;
    file_path: string;
    version: string;
  }>): Promise<APIContract | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.contract_content !== undefined) {
      updates.push(`contract_content = $${paramIndex++}`);
      values.push(JSON.stringify(data.contract_content));
    }
    if (data.file_path !== undefined) {
      updates.push(`file_path = $${paramIndex++}`);
      values.push(data.file_path);
    }
    if (data.version !== undefined) {
      updates.push(`version = $${paramIndex++}`);
      values.push(data.version);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const result = await pool.query(
      `UPDATE api_contracts SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );
    return result.rows[0] ? this.mapRowToContract(result.rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM api_contracts WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  private mapRowToContract(row: any): APIContract {
    return {
      id: row.id,
      rfc_id: row.rfc_id,
      contract_type: row.contract_type,
      contract_content: typeof row.contract_content === 'string' 
        ? JSON.parse(row.contract_content) 
        : row.contract_content,
      file_path: row.file_path,
      version: row.version,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}
