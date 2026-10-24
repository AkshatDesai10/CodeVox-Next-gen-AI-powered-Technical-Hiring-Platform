type ExampleBlock = { input?: string; output?: string; explanation?: string };

export class MarkdownBuilder {
  private parts: string[] = [];

  text(content: string) {
    if (content.trim()) this.parts.push(content.trim());
    return this;
  }

  heading(level: 2 | 3 | 4, title: string, body?: string) {
    const hashes = '#'.repeat(level);
    const block = body?.trim() ? `${hashes} ${title}\n\n${body.trim()}` : `${hashes} ${title}`;
    this.parts.push(block);
    return this;
  }

  section(title: string, body: string) {
    return this.heading(2, title, body);
  }

  list(items: string[], ordered = false) {
    if (!items.length) return this;
    const lines = items.map((item, index) => (ordered ? `${index + 1}. ${item}` : `* ${item}`));
    this.parts.push(lines.join('\n'));
    return this;
  }

  code(language: string, content: string) {
    this.parts.push(`\`\`\`${language}\n${content}\n\`\`\``);
    return this;
  }

  example(index: number, example: ExampleBlock) {
    const lines = [
      `**Example ${index}:**`,
      '',
      `**Input:** \`${example.input ?? ''}\``,
      `**Output:** \`${example.output ?? ''}\``,
    ];
    if (example.explanation?.trim()) {
      lines.push(`**Explanation:** ${example.explanation.trim()}`);
    }
    this.parts.push(lines.join('\n'));
    return this;
  }

  examples(examples: ExampleBlock[]) {
    if (!examples.length) return this;
    examples.forEach((ex, index) => this.example(index + 1, ex));
    return this;
  }

  constraints(fields: {
    input_size?: string;
    value_range?: string;
    time_limit?: string;
    memory_limit?: string;
    efficiency_note?: string;
  }) {
    const lines = [
      '**Constraints:**',
      '',
      fields.input_size ? `* \`${fields.input_size}\`` : null,
      fields.value_range ? `* \`${fields.value_range}\`` : null,
      fields.time_limit ? `* \`Time Limit: ${fields.time_limit}\`` : null,
      fields.memory_limit ? `* \`Memory Limit: ${fields.memory_limit}\`` : null,
      fields.efficiency_note ? `\n*${fields.efficiency_note}*` : null,
    ].filter(Boolean) as string[];
    
    if (lines.length > 2) {
      this.parts.push(lines.join('\n'));
    }
    return this;
  }

  build() {
    return this.parts.join('\n\n');
  }
}

export function composeCodingStatementMarkdown(result: {
  problem_statement?: string;
  input_format?: string;
  output_format?: string;
  examples?: ExampleBlock[];
  edge_cases?: string[];
  constraints?: {
    input_size?: string;
    value_range?: string;
    time_limit?: string;
    memory_limit?: string;
    efficiency_note?: string;
  };
}): string {
  const builder = new MarkdownBuilder();
  if (result.problem_statement?.trim()) builder.text(result.problem_statement);
  if (result.examples?.length) builder.examples(result.examples);
  if (result.constraints) builder.constraints(result.constraints);
  return builder.build();
}

function parseInsertSqlToMarkdownTable(sql: string): string {
  const tables: string[] = [];
  const inserts = sql.split(/INSERT\s+INTO/i);
  
  for (const insert of inserts) {
    if (!insert.trim()) continue;
    const match = insert.match(/^\s*([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*VALUES\s*([\s\S]+)/i);
    if (!match) continue;
    
    const tableName = match[1];
    const cols = match[2].split(',').map(c => c.trim().replace(/`/g, ''));
    let valuesPart = match[3].replace(/;/g, '').trim();
    
    let md = `**\`${tableName}\`**\n\n`;
    md += `| ${cols.join(' | ')} |\n`;
    md += `| ${cols.map(() => '---').join(' | ')} |\n`;
    
    const rowMatches = valuesPart.match(/\([^)]+\)/g);
    if (rowMatches) {
      for (const row of rowMatches) {
        const rowInner = row.substring(1, row.length - 1);
        const cells = rowInner.split(/,\s*(?=(?:[^']*'[^']*')*[^']*$)/).map(c => c.trim().replace(/^'|'$/g, ''));
        md += `| ${cells.join(' | ')} |\n`;
      }
    }
    tables.push(md);
  }
  return tables.join('\n\n');
}

export function composeDatabaseStatementMarkdown(result: {
  problem_statement?: string;
  scenario_description?: string;
  entity_descriptions?: Array<{ table_name?: string; description?: string }>;
  relationships?: string[];
  supported_query_patterns?: string[];
  database_schema?: { ddl_sql?: string };
  seed_data?: { insert_sql?: string };
}): string {
  const builder = new MarkdownBuilder();
  if (result.problem_statement?.trim()) builder.text(result.problem_statement);
  if (result.scenario_description?.trim()) builder.section('Scenario', result.scenario_description);
  
  if (result.entity_descriptions?.length) {
    const body = result.entity_descriptions
      .map((row) => `* **${row.table_name ?? 'table'}**: ${row.description ?? ''}`)
      .join('\n');
    builder.section('Entity Descriptions', body);
  }
  if (result.relationships?.length) builder.list(result.relationships);
  
  if (result.database_schema?.ddl_sql) {
    builder.section('Database Schema (DDL)', `\`\`\`sql\n${result.database_schema.ddl_sql.trim()}\n\`\`\``);
  }
  if (result.seed_data?.insert_sql) {
    const rawSql = result.seed_data.insert_sql.trim();
    const mdTables = parseInsertSqlToMarkdownTable(rawSql);
    
    if (mdTables) {
      builder.section('Seed Data', mdTables);
    }
  }

  if (result.supported_query_patterns?.length) {
    builder.section('Supported Query Patterns', result.supported_query_patterns.map((p) => `* ${p}`).join('\n'));
  }
  return builder.build();
}
