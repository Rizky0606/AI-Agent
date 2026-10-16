import type { ModelToolDefinition } from '@personal-ai-os/model-gateway';
import type { ToolDefinition } from '@personal-ai-os/tools';

/**
 * Maps ToolRegistry tools into OpenAI-compatible tool specifications
 * so the model can select tools via native tool calling.
 */
export function toolDefinitionToModelTool(tool: ToolDefinition): ModelToolDefinition {
  let parameters: Record<string, unknown> = {
    type: 'object',
    properties: {},
  };

  switch (tool.name) {
    case 'web_fetch':
      parameters = {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL halaman web publik lengkap (https://...) yang ingin diambil',
          },
        },
        required: ['url'],
      };
      break;

    case 'web_search':
      parameters = {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Kueri pencarian teks',
          },
          limit: {
            type: 'number',
            description: 'Jumlah hasil maksimum yang dikembalikan (1-10)',
          },
        },
        required: ['query'],
      };
      break;

    case 'browser_navigate':
      parameters = {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL halaman web tujuan navigasi Chromium',
          },
        },
        required: ['url'],
      };
      break;

    case 'workspace_read_file':
      parameters = {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Jalur relatif file dalam workspace',
          },
        },
        required: ['path'],
      };
      break;

    default:
      parameters = {
        type: 'object',
        properties: {
          input: {
            type: 'string',
            description: `Argumen input untuk operasi tool '${tool.name}'`,
          },
        },
      };
      break;
  }

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters,
    },
  };
}
