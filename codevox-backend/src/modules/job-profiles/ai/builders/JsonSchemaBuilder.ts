import type { SectionDefinition } from '../types';

export class JsonSchemaBuilder {
  private fields: Record<string, unknown> = {};

  addField(key: string, value: unknown) {
    this.fields[key] = value;
    return this;
  }

  mergeFields(fields: Record<string, unknown>) {
    Object.assign(this.fields, fields);
    return this;
  }

  fromSections(sections: SectionDefinition[]) {
    for (const section of sections) {
      Object.assign(this.fields, section.schema);
    }
    return this;
  }

  build() {
    return { ...this.fields };
  }

  toPromptJson(indent = 2) {
    return JSON.stringify(this.build(), null, indent);
  }
}

export function buildSchemaFromSections(sections: SectionDefinition[]) {
  return new JsonSchemaBuilder().fromSections(sections).build();
}
