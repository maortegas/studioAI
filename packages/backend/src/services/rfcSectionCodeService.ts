import pool from '../config/database';

export class RFCSectionCodeService {
  /**
   * Procesar contenido RFC markdown y agregar códigos únicos a cada sección
   * Formato: RFC-SEC-001, RFC-SEC-002, etc.
   */
  async processRFCAndAddSectionCodes(rfcId: string, content: string): Promise<{
    processedContent: string;
    sectionCodes: Array<{ code: string; header: string; level: number; order: number }>;
  }> {
    const lines = content.split('\n');
    const sectionCodes: Array<{ code: string; header: string; level: number; order: number }> = [];
    let sectionCounter = 0;
    let processedLines: string[] = [];
    
    for (const line of lines) {
      // Detectar headers: # Header, ## Header, ### Header
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      
      if (headerMatch) {
        const level = headerMatch[1].length;
        const headerText = headerMatch[2].trim();
        sectionCounter++;
        
        // Generar código único: RFC-SEC-001, RFC-SEC-002, etc.
        const sectionCode = `RFC-SEC-${String(sectionCounter).padStart(3, '0')}`;
        
        // Guardar mapeo de código
        sectionCodes.push({
          code: sectionCode,
          header: headerText,
          level,
          order: sectionCounter
        });
        
        // Agregar código visible después del header: ## API Endpoints `[RFC-SEC-001]`
        const hashes = headerMatch[1];
        const headerWithCode = `${hashes} ${headerText} \`[${sectionCode}]\``;
        processedLines.push(headerWithCode);
      } else {
        processedLines.push(line);
      }
    }
    
    const processedContent = processedLines.join('\n');
    
    // Guardar mapeo de códigos en base de datos
    await this.saveSectionCodes(rfcId, sectionCodes, content);
    
    return {
      processedContent,
      sectionCodes
    };
  }
  
  /**
   * Guardar mapeo de códigos a secciones en base de datos
   */
  private async saveSectionCodes(
    rfcId: string, 
    sectionCodes: Array<{ code: string; header: string; level: number; order: number }>,
    fullContent: string
  ): Promise<void> {
    // Primero, limpiar códigos existentes para este RFC
    await pool.query('DELETE FROM rfc_section_codes WHERE rfc_id = $1', [rfcId]);
    
    // Extraer contenido completo de cada sección
    const lines = fullContent.split('\n');
    const sections: Array<{ code: string; content: string }> = [];
    let currentSection: { code?: string; lines: string[] } | null = null;
    let sectionIndex = 0;
    
    for (const line of lines) {
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch && sectionIndex < sectionCodes.length) {
        // Guardar sección anterior
        if (currentSection?.code) {
          sections.push({
            code: currentSection.code,
            content: currentSection.lines.join('\n')
          });
        }
        
        // Iniciar nueva sección
        currentSection = {
          code: sectionCodes[sectionIndex].code,
          lines: [line]
        };
        sectionIndex++;
      } else if (currentSection) {
        currentSection.lines.push(line);
      }
    }
    
    // Guardar última sección
    if (currentSection?.code) {
      sections.push({
        code: currentSection.code,
        content: currentSection.lines.join('\n')
      });
    }
    
    // Insertar códigos en base de datos
    for (const sectionCode of sectionCodes) {
      const sectionContent = sections.find(s => s.code === sectionCode.code)?.content || '';
      await pool.query(
        `INSERT INTO rfc_section_codes 
         (rfc_id, section_code, section_header, section_level, section_order, full_section_content)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (rfc_id, section_code) DO UPDATE SET
           section_header = $3,
           section_level = $4,
           section_order = $5,
           full_section_content = $6`,
        [
          rfcId,
          sectionCode.code,
          sectionCode.header,
          sectionCode.level,
          sectionCode.order,
          sectionContent
        ]
      );
    }
  }
  
  /**
   * Obtener sección RFC por código
   */
  async getSectionByCode(rfcId: string, sectionCode: string): Promise<{
    code: string;
    header: string;
    level: number;
    content: string;
  } | null> {
    const result = await pool.query(
      `SELECT section_code, section_header, section_level, full_section_content
       FROM rfc_section_codes
       WHERE rfc_id = $1 AND section_code = $2`,
      [rfcId, sectionCode]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const row = result.rows[0];
    return {
      code: row.section_code,
      header: row.section_header,
      level: row.section_level,
      content: row.full_section_content
    };
  }
  
  /**
   * Obtener todas las secciones de un RFC
   */
  async getRFCSections(rfcId: string): Promise<Array<{
    code: string;
    header: string;
    level: number;
    order: number;
  }>> {
    const result = await pool.query(
      `SELECT section_code, section_header, section_level, section_order
       FROM rfc_section_codes
       WHERE rfc_id = $1
       ORDER BY section_order`,
      [rfcId]
    );
    
    return result.rows.map(row => ({
      code: row.section_code,
      header: row.section_header,
      level: row.section_level,
      order: row.section_order
    }));
  }
}

