import { registry, type ResourceConfig } from '../lib/resource.js';
import { z } from '../lib/validation.js';

/**
 * The API docs (RP1-11), served at /docs. Built from the resources the pages register with the CRUD kit,
 * so a new page appears here without extra work. The frontend developer reads this with the Jira story.
 */
type Schema = Record<string, unknown>;

/** JSON Schema of a form: field types from zod; required = fields that refuse an empty value. */
function formSchema(schema: z.ZodObject): Schema {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Schema;
  delete json.$schema;
  const required = Object.entries(schema.shape)
    .filter(([, field]) => !(field as z.ZodType).safeParse(undefined).success)
    .map(([key]) => key);
  return { ...json, required };
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: unknown) => ({ 'application/json': { schema } });
const ok = (description: string, schema?: unknown) => ({
  description,
  ...(schema ? { content: json(schema) } : {}),
});
const errors = {
  '400': ok('Validation: `error.fields` keyed by form field', ref('Error')),
  '401': ok('Not signed in', ref('Error')),
  '404': ok('Not found', ref('Error')),
};
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
const query = (name: string, description = '', type = 'string') => ({
  name,
  in: 'query',
  required: false,
  description,
  schema: { type },
});

function recordSchema(r: ResourceConfig): Schema {
  const form = formSchema(r.schema);
  const properties: Schema = { id: { type: 'string' }, ...(form.properties as Schema) };
  for (const key of Object.keys(r.refs ?? {})) properties[`${key}Name`] = { type: ['string', 'null'] };
  for (const key of r.files ?? []) properties[`${key}Url`] = { description: 'Signed link(s) to the file(s)' };
  for (const child of r.children ?? [])
    properties[child.key] = { type: 'array', items: formSchema(child.schema) };
  for (const key of ['createdAt', 'updatedAt']) properties[key] = { type: 'string', format: 'date-time' };
  for (const key of ['createdBy', 'updatedBy']) properties[key] = { type: 'string' };
  return { type: 'object', properties };
}

function bodySchema(r: ResourceConfig): Schema {
  const form = formSchema(r.schema);
  const properties = { ...(form.properties as Schema) };
  for (const child of r.children ?? [])
    properties[child.key] = { type: 'array', items: formSchema(child.schema) };
  return { ...form, properties };
}

function resourcePaths(r: ResourceConfig & { path: string }) {
  const name = r.label;
  const tag = [name];
  const record = recordSchema(r);
  const body = { required: true, content: json(bodySchema(r)) };
  const filters = (r.filters ?? []).map((f) => query(f, 'Equals'));
  const paths: Record<string, unknown> = {
    [r.path]: {
      get: {
        tags: tag,
        summary: `List ${name.toLowerCase()} records`,
        parameters: [
          query('search', `Searches ${(r.search ?? []).join(', ') || '—'}`),
          query('page', '1-based', 'integer'),
          query('perPage', '1–100, default 10', 'integer'),
          ...filters,
        ],
        responses: {
          '200': ok('Page of records', {
            type: 'object',
            properties: { data: { type: 'array', items: record }, meta: ref('Meta') },
          }),
          '401': errors['401'],
        },
      },
      post: {
        tags: tag,
        summary: `Create ${name.toLowerCase()}`,
        requestBody: body,
        responses: { '201': ok('Created', record), '409': ok('Duplicate code', ref('Error')), ...errors },
      },
    },
    [`${r.path}/{id}`]: {
      get: {
        tags: tag,
        summary: `One ${name.toLowerCase()}`,
        parameters: [idParam],
        responses: { '200': ok('Record', record), ...errors },
      },
      put: {
        tags: tag,
        summary: `Edit ${name.toLowerCase()} (send the whole form)`,
        parameters: [idParam],
        requestBody: body,
        responses: { '200': ok('Saved', record), '409': ok('Duplicate code', ref('Error')), ...errors },
      },
      delete: {
        tags: tag,
        summary: 'Delete (soft)',
        parameters: [idParam],
        responses: { '204': ok('Deleted'), ...errors },
      },
    },
    [`${r.path}/{id}/restore`]: {
      post: {
        tags: tag,
        summary: 'Undo a delete',
        parameters: [idParam],
        responses: { '200': ok('Restored', record), ...errors },
      },
    },
    [`${r.path}/{id}/history`]: {
      get: {
        tags: tag,
        summary: 'Edit log, newest first',
        parameters: [idParam],
        responses: { '200': ok('History', { type: 'array', items: ref('HistoryEntry') }), ...errors },
      },
    },
  };
  if (r.summary)
    paths[`${r.path}/summary`] = {
      get: {
        tags: tag,
        summary: 'Summary cards',
        parameters: filters,
        responses: { '200': ok('Card values', { type: 'object' }) },
      },
    };
  if (r.options)
    paths[`/options/${r.options.path}`] = {
      get: {
        tags: ['Dropdown options'],
        summary: `${name} choices for a dropdown`,
        parameters: (r.options.filters ?? []).map((f) => query(f)),
        responses: { '200': ok('Options', { type: 'array', items: ref('Option') }) },
      },
    };
  return paths;
}

const fixedPaths = {
  '/auth/login': {
    post: {
      tags: ['Login'],
      summary: 'Sign in with username or email',
      security: [],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', example: 'admin' },
            password: { type: 'string', example: 'Admin@12345' },
          },
        }),
      },
      responses: {
        '200': ok('Signed in', {
          type: 'object',
          properties: {
            accessToken: { type: 'string' },
            refreshToken: { type: 'string' },
            user: ref('User'),
          },
        }),
        '400': errors['400'],
        '401': ok('Wrong username or password', ref('Error')),
      },
    },
  },
  '/auth/refresh': {
    post: {
      tags: ['Login'],
      summary: 'New tokens for a refresh token (the old one is used up)',
      security: [],
      requestBody: { required: true, content: json(ref('RefreshBody')) },
      responses: { '200': ok('New tokens', ref('Tokens')), '401': ok('Session ended', ref('Error')) },
    },
  },
  '/auth/logout': {
    post: {
      tags: ['Login'],
      summary: 'Sign out (revokes the refresh token)',
      security: [],
      requestBody: { required: true, content: json(ref('RefreshBody')) },
      responses: { '204': ok('Signed out') },
    },
  },
  '/auth/me': {
    get: {
      tags: ['Login'],
      summary: 'The signed-in user',
      responses: {
        '200': ok('User', { type: 'object', properties: { user: ref('User') } }),
        '401': errors['401'],
      },
    },
  },
  '/files': {
    post: {
      tags: ['Files'],
      summary: 'Upload one file (JPG, PNG, WebP, PDF; 10 MB)',
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: { file: { type: 'string', format: 'binary' } },
            },
          },
        },
      },
      responses: { '201': ok('Stored', ref('File')), '400': errors['400'], '401': errors['401'] },
    },
  },
  '/files/{id}': {
    get: {
      tags: ['Files'],
      summary: 'File description',
      parameters: [idParam],
      responses: { '200': ok('File', ref('File')), '404': errors['404'] },
    },
  },
  '/files/{id}/content': {
    get: {
      tags: ['Files'],
      summary: 'The file itself (use the signed `url`; no token needed)',
      security: [],
      parameters: [
        idParam,
        { ...query('sig', 'Signature from `url`'), required: true },
        query('download', 'Set to 1 to download'),
      ],
      responses: { '200': ok('File bytes'), '404': errors['404'] },
    },
  },
};

export function buildOpenApi() {
  const paths: Record<string, unknown> = { ...fixedPaths };
  for (const r of registry) Object.assign(paths, resourcePaths(r));
  return {
    openapi: '3.1.0',
    info: {
      title: 'RupAI Phase 1 API',
      version: '1.0.0',
      description:
        'Backend for rupai-backend-dashboard (Jira RP1). Sign in with `POST /auth/login` (`admin` / `Admin@12345` after the seed), then press **Authorize** and paste the `accessToken`. Body and response keys are the form field names. Errors: `{ error: { code, message, fields } }`.',
    },
    servers: [{ url: '/api/v1' }],
    security: [{ bearer: [] }],
    paths,
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  enum: ['VALIDATION', 'UNAUTHENTICATED', 'NOT_FOUND', 'DUPLICATE', 'SERVER_ERROR'],
                },
                message: { type: 'string' },
                fields: { type: 'object', additionalProperties: { type: 'string' } },
              },
            },
          },
        },
        Meta: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            perPage: { type: 'integer' },
            total: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
        Option: {
          type: 'object',
          properties: { id: { type: 'string' }, value: { type: 'string' }, label: { type: 'string' } },
        },
        HistoryEntry: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['create', 'update', 'delete', 'restore'] },
            oldData: { type: ['object', 'null'] },
            newData: { type: ['object', 'null'] },
            changedBy: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
            changedAt: { type: 'string', format: 'date-time' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            username: { type: 'string' },
            email: { type: ['string', 'null'] },
          },
        },
        Tokens: {
          type: 'object',
          properties: { accessToken: { type: 'string' }, refreshToken: { type: 'string' } },
        },
        RefreshBody: {
          type: 'object',
          required: ['refreshToken'],
          properties: { refreshToken: { type: 'string' } },
        },
        File: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            url: { type: 'string' },
            name: { type: 'string' },
            size: { type: 'integer' },
            type: { type: 'string' },
          },
        },
      },
    },
  };
}
