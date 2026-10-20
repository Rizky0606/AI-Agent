import {
  ToolRegistry,
  createWorkspaceReadFileTool,
  createWebSearchTool,
  createWebFetchTool,
  createMemoryRecallTool,
  createHostExecuteCommandTool,
} from '@personal-ai-os/tools';
import { PermissionEngine, SecuredCapabilityGuard, type ActorContext } from '@personal-ai-os/permissions';
import { HostToolMcpServer } from '../server/host-tool-server.ts';

function parseArgs(argv: string[]): {
  workspaceDir: string;
  actorId: string;
  role: 'admin' | 'user' | 'system' | 'guest';
  taskId?: string | undefined;
  conversationId?: string | undefined;
} {
  let workspaceDir = process.cwd();
  let actorId = 'system:runtime-bridge';
  let role: 'admin' | 'user' | 'system' | 'guest' = 'user';
  let taskId: string | undefined;
  let conversationId: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--workspace' && i + 1 < argv.length) {
      workspaceDir = argv[++i]!;
    } else if (arg === '--actor-id' && i + 1 < argv.length) {
      actorId = argv[++i]!;
    } else if (arg === '--role' && i + 1 < argv.length) {
      const r = argv[++i]!;
      if (r === 'admin' || r === 'user' || r === 'system' || r === 'guest') {
        role = r;
      }
    } else if (arg === '--task-id' && i + 1 < argv.length) {
      taskId = argv[++i]!;
    } else if (arg === '--conversation-id' && i + 1 < argv.length) {
      conversationId = argv[++i]!;
    }
  }

  return { workspaceDir, actorId, role, taskId, conversationId };
}

async function main(): Promise<void> {
  const { workspaceDir, actorId, role, taskId, conversationId } = parseArgs(process.argv);

  const engine = new PermissionEngine();
  const guard = new SecuredCapabilityGuard(engine);
  const registry = new ToolRegistry(guard);

  // Register safe host tools
  registry.registerTool(createWorkspaceReadFileTool(workspaceDir));
  registry.registerTool(createWebSearchTool());
  registry.registerTool(createWebFetchTool());
  registry.registerTool(createMemoryRecallTool());
  registry.registerTool(createHostExecuteCommandTool());

  const actor: ActorContext = {
    id: actorId,
    role,
  };

  const server = new HostToolMcpServer({
    registry,
    actor,
    workspaceDir,
    taskId,
    conversationId,
  });

  await server.runStdio(process.stdin, process.stdout);
}

if (process.argv[1]?.includes('host-tool-entry')) {
  main().catch((err) => {
    process.stderr.write(`HostToolEntry error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
