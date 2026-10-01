import type { ZodType } from 'zod';

export interface BatchSchemaRegistration {
  feature: string;
  promptVersion: string;
  schema: ZodType<unknown>;
}

function key(feature: string, promptVersion: string): string {
  return `${feature}\u0000${promptVersion}`;
}

/**
 * Runtime registry for durable provider-batch output schemas. The registry is configured at the
 * application composition root, so a new batch feature contributes its own versioned schema without
 * changing this library. Versioning is part of the key because an old provider batch may finish after
 * a deployment has introduced a newer prompt/output schema.
 */
export class BatchSchemaRegistry {
  private readonly schemas = new Map<string, ZodType<unknown>>();

  constructor(registrations: readonly BatchSchemaRegistration[] = []) {
    for (const registration of registrations) this.register(registration);
  }

  register(registration: BatchSchemaRegistration): void {
    const registrationKey = key(registration.feature, registration.promptVersion);
    if (this.schemas.has(registrationKey)) {
      throw new Error(
        `Duplicate batch output schema for feature "${registration.feature}" ` +
          `and prompt version "${registration.promptVersion}"`,
      );
    }
    this.schemas.set(registrationKey, registration.schema);
  }

  get(feature: string, promptVersion: string): ZodType<unknown> {
    const schema = this.schemas.get(key(feature, promptVersion));
    if (schema === undefined) {
      throw new Error(
        `No batch output schema registered for feature "${feature}" ` +
          `and prompt version "${promptVersion}"`,
      );
    }
    return schema;
  }
}
