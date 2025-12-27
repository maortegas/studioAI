import pool from '../config/database';

export interface TraceabilityGap {
  type: string;
  item_id: string;
  item_title: string;
  missing: string;
}

export interface ProjectCompleteness {
  prd: {
    exists: boolean;
    status: string | null;
    id: string | null;
  };
  stories: {
    total: number;
    with_prd: number;
    with_design: number;
    with_rfc: number;
    with_breakdown: number;
    with_coding: number;
    without_prd: Array<{ id: string; title: string }>;
    without_design: Array<{ id: string; title: string }>;
    without_rfc: Array<{ id: string; title: string }>;
    without_breakdown: Array<{ id: string; title: string }>;
    without_coding: Array<{ id: string; title: string }>;
  };
  designs: {
    total: number;
    with_stories: number;
    with_rfc: number;
    without_stories: Array<{ id: string; flow_name: string }>;
    without_rfc: Array<{ id: string; flow_name: string }>;
  };
  rfc: {
    total: number;
    approved: number;
    with_breakdown: number;
    without_breakdown: Array<{ id: string; title: string }>;
    not_approved: Array<{ id: string; title: string; status: string }>;
  };
  breakdowns: {
    total: number;
    with_rfc: number;
    with_coding: number;
    without_rfc: Array<{ id: string; title: string }>;
    without_coding: Array<{ id: string; title: string }>;
  };
  gaps: TraceabilityGap[];
}

export class TraceabilityRepository {
  /**
   * Get project completeness
   */
  async getProjectCompleteness(projectId: string): Promise<ProjectCompleteness> {
    // Get PRD
    const prdResult = await pool.query(
      `SELECT id, status FROM prd_documents WHERE project_id = $1 LIMIT 1`,
      [projectId]
    );
    const prd = prdResult.rows[0] || null;

    // Get all stories
    const storiesResult = await pool.query(
      `SELECT id, title, prd_id, epic_id FROM tasks 
       WHERE project_id = $1 AND type = 'story'`,
      [projectId]
    );
    const allStories = storiesResult.rows;

    // Get stories with PRD
    const storiesWithPRD = allStories.filter((s: any) => s.prd_id);

    // Get stories with design
    const storiesWithDesignResult = await pool.query(
      `SELECT DISTINCT t.id, t.title 
       FROM tasks t
       INNER JOIN story_user_flows suf ON t.id = suf.story_id
       WHERE t.project_id = $1 AND t.type = 'story'`,
      [projectId]
    );
    const storiesWithDesign = storiesWithDesignResult.rows;

    // Get stories with RFC (through epic or direct)
    const storiesWithRFCResult = await pool.query(
      `SELECT DISTINCT t.id, t.title
       FROM tasks t
       LEFT JOIN epics e ON t.epic_id = e.id
       LEFT JOIN rfc_documents r ON e.rfc_id = r.id OR t.id IN (
         SELECT story_id FROM story_user_flows suf
         INNER JOIN rfc_documents rfc ON suf.user_flow_id = rfc.user_flow_id
       )
       WHERE t.project_id = $1 AND t.type = 'story' AND (e.rfc_id IS NOT NULL OR r.id IS NOT NULL)`,
      [projectId]
    );
    const storiesWithRFC = storiesWithRFCResult.rows;

    // Get stories with breakdown (have epic with tasks)
    const storiesWithBreakdownResult = await pool.query(
      `SELECT DISTINCT t.id, t.title
       FROM tasks t
       INNER JOIN epics e ON t.epic_id = e.id
       WHERE t.project_id = $1 AND t.type = 'story' AND e.id IS NOT NULL`,
      [projectId]
    );
    const storiesWithBreakdown = storiesWithBreakdownResult.rows;

    // Get stories with coding sessions
    const storiesWithCodingResult = await pool.query(
      `SELECT DISTINCT t.id, t.title
       FROM tasks t
       INNER JOIN coding_sessions cs ON t.id = cs.story_id
       WHERE t.project_id = $1 AND t.type = 'story'`,
      [projectId]
    );
    const storiesWithCoding = storiesWithCodingResult.rows;

    // Get all user flows
    const flowsResult = await pool.query(
      `SELECT id, flow_name FROM user_flows WHERE project_id = $1`,
      [projectId]
    );
    const allFlows = flowsResult.rows;

    // Get flows with stories
    const flowsWithStoriesResult = await pool.query(
      `SELECT DISTINCT uf.id, uf.flow_name
       FROM user_flows uf
       INNER JOIN story_user_flows suf ON uf.id = suf.user_flow_id
       WHERE uf.project_id = $1`,
      [projectId]
    );
    const flowsWithStories = flowsWithStoriesResult.rows;

    // Get flows with RFC
    const flowsWithRFCResult = await pool.query(
      `SELECT id, flow_name FROM user_flows 
       WHERE project_id = $1 AND id IN (SELECT user_flow_id FROM rfc_documents WHERE user_flow_id IS NOT NULL)`,
      [projectId]
    );
    const flowsWithRFC = flowsWithRFCResult.rows;

    // Get all RFCs
    const rfcResult = await pool.query(
      `SELECT id, title, status FROM rfc_documents WHERE project_id = $1`,
      [projectId]
    );
    const allRFCs = rfcResult.rows;

    // Get RFCs with breakdown
    const rfcWithBreakdownResult = await pool.query(
      `SELECT DISTINCT r.id, r.title
       FROM rfc_documents r
       INNER JOIN epics e ON r.id = e.rfc_id
       WHERE r.project_id = $1`,
      [projectId]
    );
    const rfcWithBreakdown = rfcWithBreakdownResult.rows;

    // Get all epics
    const epicsResult = await pool.query(
      `SELECT id, title, rfc_id FROM epics WHERE project_id = $1`,
      [projectId]
    );
    const allEpics = epicsResult.rows;

    // Get epics with coding (have tasks with coding sessions)
    const epicsWithCodingResult = await pool.query(
      `SELECT DISTINCT e.id, e.title
       FROM epics e
       INNER JOIN tasks t ON e.id = t.epic_id
       INNER JOIN coding_sessions cs ON t.id = cs.story_id
       WHERE e.project_id = $1`,
      [projectId]
    );
    const epicsWithCoding = epicsWithCodingResult.rows;

    // Calculate gaps
    const gaps: TraceabilityGap[] = [];

    // Stories without PRD
    allStories
      .filter((s: any) => !s.prd_id)
      .forEach((s: any) => {
        gaps.push({
          type: 'story_missing_prd',
          item_id: s.id,
          item_title: s.title,
          missing: 'PRD link'
        });
      });

    // Stories without design
    allStories
      .filter((s: any) => !storiesWithDesign.find((d: any) => d.id === s.id))
      .forEach((s: any) => {
        gaps.push({
          type: 'story_missing_design',
          item_id: s.id,
          item_title: s.title,
          missing: 'User flow (design)'
        });
      });

    // Stories without RFC
    allStories
      .filter((s: any) => !storiesWithRFC.find((r: any) => r.id === s.id))
      .forEach((s: any) => {
        gaps.push({
          type: 'story_missing_rfc',
          item_id: s.id,
          item_title: s.title,
          missing: 'RFC'
        });
      });

    // Stories without breakdown
    allStories
      .filter((s: any) => !storiesWithBreakdown.find((b: any) => b.id === s.id))
      .forEach((s: any) => {
        gaps.push({
          type: 'story_missing_breakdown',
          item_id: s.id,
          item_title: s.title,
          missing: 'Breakdown (epic)'
        });
      });

    // Stories without coding
    allStories
      .filter((s: any) => !storiesWithCoding.find((c: any) => c.id === s.id))
      .forEach((s: any) => {
        gaps.push({
          type: 'story_missing_coding',
          item_id: s.id,
          item_title: s.title,
          missing: 'Coding session'
        });
      });

    // Flows without stories
    allFlows
      .filter((f: any) => !flowsWithStories.find((s: any) => s.id === f.id))
      .forEach((f: any) => {
        gaps.push({
          type: 'design_missing_stories',
          item_id: f.id,
          item_title: f.flow_name,
          missing: 'Linked stories'
        });
      });

    // Flows without RFC
    allFlows
      .filter((f: any) => !flowsWithRFC.find((r: any) => r.id === f.id))
      .forEach((f: any) => {
        gaps.push({
          type: 'design_missing_rfc',
          item_id: f.id,
          item_title: f.flow_name,
          missing: 'RFC'
        });
      });

    // RFCs without breakdown
    allRFCs
      .filter((r: any) => !rfcWithBreakdown.find((b: any) => b.id === r.id))
      .forEach((r: any) => {
        gaps.push({
          type: 'rfc_missing_breakdown',
          item_id: r.id,
          item_title: r.title,
          missing: 'Breakdown (epic)'
        });
      });

    // RFCs not approved
    allRFCs
      .filter((r: any) => r.status !== 'approved')
      .forEach((r: any) => {
        gaps.push({
          type: 'rfc_not_approved',
          item_id: r.id,
          item_title: r.title,
          missing: `Approval (current status: ${r.status})`
        });
      });

    // Epics without RFC
    allEpics
      .filter((e: any) => !e.rfc_id)
      .forEach((e: any) => {
        gaps.push({
          type: 'epic_missing_rfc',
          item_id: e.id,
          item_title: e.title,
          missing: 'RFC'
        });
      });

    // Epics without coding
    allEpics
      .filter((e: any) => !epicsWithCoding.find((c: any) => c.id === e.id))
      .forEach((e: any) => {
        gaps.push({
          type: 'epic_missing_coding',
          item_id: e.id,
          item_title: e.title,
          missing: 'Coding sessions'
        });
      });

    return {
      prd: {
        exists: !!prd,
        status: prd?.status || null,
        id: prd?.id || null
      },
      stories: {
        total: allStories.length,
        with_prd: storiesWithPRD.length,
        with_design: storiesWithDesign.length,
        with_rfc: storiesWithRFC.length,
        with_breakdown: storiesWithBreakdown.length,
        with_coding: storiesWithCoding.length,
        without_prd: allStories.filter((s: any) => !s.prd_id).map((s: any) => ({ id: s.id, title: s.title })),
        without_design: allStories.filter((s: any) => !storiesWithDesign.find((d: any) => d.id === s.id)).map((s: any) => ({ id: s.id, title: s.title })),
        without_rfc: allStories.filter((s: any) => !storiesWithRFC.find((r: any) => r.id === s.id)).map((s: any) => ({ id: s.id, title: s.title })),
        without_breakdown: allStories.filter((s: any) => !storiesWithBreakdown.find((b: any) => b.id === s.id)).map((s: any) => ({ id: s.id, title: s.title })),
        without_coding: allStories.filter((s: any) => !storiesWithCoding.find((c: any) => c.id === s.id)).map((s: any) => ({ id: s.id, title: s.title }))
      },
      designs: {
        total: allFlows.length,
        with_stories: flowsWithStories.length,
        with_rfc: flowsWithRFC.length,
        without_stories: allFlows.filter((f: any) => !flowsWithStories.find((s: any) => s.id === f.id)).map((f: any) => ({ id: f.id, flow_name: f.flow_name })),
        without_rfc: allFlows.filter((f: any) => !flowsWithRFC.find((r: any) => r.id === f.id)).map((f: any) => ({ id: f.id, flow_name: f.flow_name }))
      },
      rfc: {
        total: allRFCs.length,
        approved: allRFCs.filter((r: any) => r.status === 'approved').length,
        with_breakdown: rfcWithBreakdown.length,
        without_breakdown: allRFCs.filter((r: any) => !rfcWithBreakdown.find((b: any) => b.id === r.id)).map((r: any) => ({ id: r.id, title: r.title })),
        not_approved: allRFCs.filter((r: any) => r.status !== 'approved').map((r: any) => ({ id: r.id, title: r.title, status: r.status }))
      },
      breakdowns: {
        total: allEpics.length,
        with_rfc: allEpics.filter((e: any) => e.rfc_id).length,
        with_coding: epicsWithCoding.length,
        without_rfc: allEpics.filter((e: any) => !e.rfc_id).map((e: any) => ({ id: e.id, title: e.title })),
        without_coding: allEpics.filter((e: any) => !epicsWithCoding.find((c: any) => c.id === e.id)).map((e: any) => ({ id: e.id, title: e.title }))
      },
      gaps
    };
  }

  /**
   * Get full traceability chain for a story
   */
  async getStoryTraceability(storyId: string): Promise<{
    story: any;
    prd?: any;
    designs?: any[];
    rfc?: any;
    epic?: any;
    breakdownTasks?: any[];
    codingSessions?: any[];
    gaps: string[];
  }> {
    const gaps: string[] = [];

    // Get story
    const storyResult = await pool.query(
      `SELECT * FROM tasks WHERE id = $1`,
      [storyId]
    );
    if (storyResult.rows.length === 0) {
      throw new Error('Story not found');
    }
    const story = storyResult.rows[0];

    // Get PRD
    let prd = null;
    if (story.prd_id) {
      const prdResult = await pool.query(
        `SELECT * FROM prd_documents WHERE id = $1`,
        [story.prd_id]
      );
      prd = prdResult.rows[0] || null;
    } else {
      gaps.push('Story is not linked to a PRD');
    }

    // Get designs (user flows)
    const designsResult = await pool.query(
      `SELECT uf.* FROM user_flows uf
       INNER JOIN story_user_flows suf ON uf.id = suf.user_flow_id
       WHERE suf.story_id = $1`,
      [storyId]
    );
    const designs = designsResult.rows;
    if (designs.length === 0) {
      gaps.push('Story has no linked user flows (design)');
    }

    // Get RFC (through design or epic)
    let rfc = null;
    if (designs.length > 0) {
      const rfcResult = await pool.query(
        `SELECT * FROM rfc_documents WHERE user_flow_id = $1 LIMIT 1`,
        [designs[0].id]
      );
      rfc = rfcResult.rows[0] || null;
    }

    // Get epic and breakdown
    let epic = null;
    let breakdownTasks: any[] = [];
    if (story.epic_id) {
      const epicResult = await pool.query(
        `SELECT * FROM epics WHERE id = $1`,
        [story.epic_id]
      );
      epic = epicResult.rows[0] || null;

      if (epic) {
        // Get RFC from epic if not found from design
        if (!rfc && epic.rfc_id) {
          const rfcResult = await pool.query(
            `SELECT * FROM rfc_documents WHERE id = $1`,
            [epic.rfc_id]
          );
          rfc = rfcResult.rows[0] || null;
        }

        // Get breakdown tasks
        const tasksResult = await pool.query(
          `SELECT * FROM tasks WHERE epic_id = $1 AND type = 'task' ORDER BY breakdown_order`,
          [epic.id]
        );
        breakdownTasks = tasksResult.rows;
      }
    } else {
      gaps.push('Story has no epic (breakdown)');
    }

    if (!rfc) {
      gaps.push('Story has no linked RFC');
    }

    // Get coding sessions
    const sessionsResult = await pool.query(
      `SELECT * FROM coding_sessions WHERE story_id = $1 ORDER BY created_at`,
      [storyId]
    );
    const codingSessions = sessionsResult.rows;
    if (codingSessions.length === 0) {
      gaps.push('Story has no coding sessions');
    }

    return {
      story,
      prd: prd || undefined,
      designs: designs.length > 0 ? designs : undefined,
      rfc: rfc || undefined,
      epic: epic || undefined,
      breakdownTasks: breakdownTasks.length > 0 ? breakdownTasks : undefined,
      codingSessions: codingSessions.length > 0 ? codingSessions : undefined,
      gaps
    };
  }
}

