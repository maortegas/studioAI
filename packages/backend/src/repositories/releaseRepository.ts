import pool from '../config/database';
import { Release, CreateReleaseRequest, UpdateReleaseRequest, ReleaseSummary } from '@devflow-studio/shared';

export class ReleaseRepository {
  async create(data: CreateReleaseRequest): Promise<Release> {
    const result = await pool.query(
      `INSERT INTO releases (
        project_id, version, status, title, description, changelog, 
        release_notes, git_tag, release_date, artifacts, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        data.project_id,
        data.version,
        data.status || 'draft',
        data.title || null,
        data.description || null,
        data.changelog || null,
        data.release_notes || null,
        data.git_tag || null,
        data.release_date || null,
        data.artifacts ? JSON.stringify(data.artifacts) : null,
        data.metadata ? JSON.stringify(data.metadata) : null,
      ]
    );
    return this.mapRowToRelease(result.rows[0]);
  }

  async findById(id: string): Promise<Release | null> {
    const result = await pool.query('SELECT * FROM releases WHERE id = $1', [id]);
    return result.rows.length > 0 ? this.mapRowToRelease(result.rows[0]) : null;
  }

  async findByProject(projectId: string): Promise<Release[]> {
    const result = await pool.query(
      'SELECT * FROM releases WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    return result.rows.map(row => this.mapRowToRelease(row));
  }

  async findByVersion(projectId: string, version: string): Promise<Release | null> {
    const result = await pool.query(
      'SELECT * FROM releases WHERE project_id = $1 AND version = $2',
      [projectId, version]
    );
    return result.rows.length > 0 ? this.mapRowToRelease(result.rows[0]) : null;
  }

  async update(id: string, data: UpdateReleaseRequest): Promise<Release> {
    const updates: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.version !== undefined) {
      updates.push(`version = $${paramCount++}`);
      values.push(data.version);
    }
    if (data.status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(data.status);
    }
    if (data.title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(data.title);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(data.description);
    }
    if (data.changelog !== undefined) {
      updates.push(`changelog = $${paramCount++}`);
      values.push(data.changelog);
    }
    if (data.release_notes !== undefined) {
      updates.push(`release_notes = $${paramCount++}`);
      values.push(data.release_notes);
    }
    if (data.git_tag !== undefined) {
      updates.push(`git_tag = $${paramCount++}`);
      values.push(data.git_tag);
    }
    if (data.release_date !== undefined) {
      updates.push(`release_date = $${paramCount++}`);
      values.push(data.release_date);
    }
    if (data.artifacts !== undefined) {
      updates.push(`artifacts = $${paramCount++}`);
      values.push(JSON.stringify(data.artifacts));
    }
    if (data.metadata !== undefined) {
      updates.push(`metadata = $${paramCount++}`);
      values.push(JSON.stringify(data.metadata));
    }

    if (updates.length === 0) {
      const existing = await this.findById(id);
      if (!existing) {
        throw new Error('Release not found');
      }
      return existing;
    }

    values.push(id);
    const query = `UPDATE releases SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    const result = await pool.query(query, values);
    return this.mapRowToRelease(result.rows[0]);
  }

  async delete(id: string): Promise<void> {
    await pool.query('DELETE FROM releases WHERE id = $1', [id]);
  }

  async getSummary(projectId: string): Promise<ReleaseSummary> {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_releases,
        COUNT(*) FILTER (WHERE status = 'published') as published_releases,
        MAX(version) FILTER (WHERE status = 'published') as latest_version,
        MAX(release_date) FILTER (WHERE status = 'published') as latest_release_date
      FROM releases
      WHERE project_id = $1`,
      [projectId]
    );

    const row = result.rows[0];
    return {
      total_releases: parseInt(row.total_releases || '0'),
      published_releases: parseInt(row.published_releases || '0'),
      latest_version: row.latest_version || undefined,
      latest_release_date: row.latest_release_date ? new Date(row.latest_release_date) : undefined,
    };
  }

  private mapRowToRelease(row: any): Release {
    // PostgreSQL JSONB fields are already parsed, but check if they're strings first
    const parseJsonField = (field: any) => {
      if (!field) return undefined;
      if (typeof field === 'string') {
        try {
          return JSON.parse(field);
        } catch {
          return field;
        }
      }
      return field;
    };

    return {
      id: row.id,
      project_id: row.project_id,
      version: row.version,
      status: row.status,
      title: row.title,
      description: row.description,
      changelog: row.changelog,
      release_notes: row.release_notes,
      git_tag: row.git_tag,
      release_date: row.release_date ? new Date(row.release_date) : undefined,
      created_by: row.created_by,
      artifacts: parseJsonField(row.artifacts),
      metadata: parseJsonField(row.metadata),
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}
