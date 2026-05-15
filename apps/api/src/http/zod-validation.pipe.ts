import { ArgumentMetadata, Injectable, PipeTransform, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ZodType } from 'zod';

export const ZOD_SCHEMA_METADATA_KEY = Symbol('zod-schema');

export function ZodSchema(schema: ZodType): ClassDecorator {
  return SetMetadata(ZOD_SCHEMA_METADATA_KEY, schema) as ClassDecorator;
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly reflector: Reflector) {}

  transform(value: unknown, metadata: ArgumentMetadata) {
    const metatype = metadata.metatype;
    const schema =
      metatype === undefined
        ? undefined
        : this.reflector.get<ZodType | undefined>(ZOD_SCHEMA_METADATA_KEY, metatype);

    if (schema === undefined) {
      return value;
    }

    return schema.parse(value);
  }
}
