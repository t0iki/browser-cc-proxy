import { z } from 'zod';

export function zodToJsonSchema(schema: z.ZodType<any>): any {
  const def = schema._def;
  
  if (def.typeName === 'ZodString') {
    return { type: 'string' };
  } else if (def.typeName === 'ZodNumber') {
    return { type: 'number' };
  } else if (def.typeName === 'ZodBoolean') {
    return { type: 'boolean' };
  } else if (def.typeName === 'ZodArray') {
    const itemSchema = zodToJsonSchema(def.type);
    return {
      type: 'array',
      items: itemSchema
    };
  } else if (def.typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: def.values
    };
  } else if (def.typeName === 'ZodObject') {
    const properties: any = {};
    const required: string[] = [];
    
    for (const [key, value] of Object.entries(def.shape())) {
      properties[key] = zodToJsonSchema(value as z.ZodType<any>);
      if (!(value as any).isOptional()) {
        required.push(key);
      }
    }
    
    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false
    };
  } else if (def.typeName === 'ZodOptional') {
    return zodToJsonSchema(def.innerType);
  } else if (def.typeName === 'ZodDefault') {
    const inner = zodToJsonSchema(def.innerType);
    inner.default = def.defaultValue();
    return inner;
  }
  
  return { type: 'any' };
}