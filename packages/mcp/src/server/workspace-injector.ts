import { writeFile, chmod, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface WorkspaceMcpConfigOptions {
  workspaceDir: string;
  serverScriptPath: string;
  serverName?: string | undefined;
  nodeBinary?: string | undefined;
  extraArgs?: string[] | undefined;
  env?: Record<string, string> | undefined;
}

export interface McpServerConfigPayload {
  mcpServers: Record<
    string,
    {
      command: string;
      args: string[];
      env?: Record<string, string> | undefined;
    }
  >;
}

/**
 * Injects a scoped .mcp.json file into the target workspace directory, enabling
 * native tool discovery for runtimes like OMP and Pi without opening public network ports.
 */
export async function injectWorkspaceMcpConfig(
  options: WorkspaceMcpConfigOptions,
): Promise<{ configPath: string; payload: McpServerConfigPayload }> {
  const serverName = options.serverName ?? 'personal-ai-host-tools';
  const nodeBin = options.nodeBinary ?? 'node';
  const configPath = join(options.workspaceDir, '.mcp.json');

  const args = [
    '--experimental-strip-types',
    options.serverScriptPath,
    '--workspace',
    options.workspaceDir,
    ...(options.extraArgs ?? []),
  ];

  const payload: McpServerConfigPayload = {
    mcpServers: {
      [serverName]: {
        command: nodeBin,
        args,
        ...(options.env ? { env: options.env } : {}),
      },
    },
  };

  const jsonContent = JSON.stringify(payload, null, 2);
  await writeFile(configPath, jsonContent, { encoding: 'utf8', mode: 0o600 });
  try {
    await chmod(configPath, 0o600);
  } catch {
    // Chmod may not apply on Windows NTFS, safe to ignore
  }

  return { configPath, payload };
}

/**
 * Safely removes the injected .mcp.json from the workspace.
 */
export async function removeWorkspaceMcpConfig(workspaceDir: string): Promise<void> {
  const configPath = join(workspaceDir, '.mcp.json');
  try {
    await unlink(configPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}
