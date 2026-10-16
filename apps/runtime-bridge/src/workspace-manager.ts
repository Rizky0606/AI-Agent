import { mkdir, lstat, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, relative, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

function contained(root: string, candidate: string): boolean { const value = relative(root, candidate); return value === '' || (value !== '..' && !value.startsWith(`..${resolve('/')}`) && !isAbsolute(value)); }
function safePart(value: string): boolean { return value.length > 0 && value.length <= 128 && !value.includes('\0') && !value.split('/').some(part => part === '..'); }

export async function prepareWorkspace(rootInput: string, workspaceId: string, taskId: string): Promise<string> {
  if (!safePart(workspaceId) || isAbsolute(workspaceId)) throw new Error('invalid workspaceId');
  if (!safePart(taskId)) throw new Error('invalid taskId');
  await mkdir(rootInput, { recursive: true, mode: 0o700 });
  const root = await realpath(rootInput);
  const projectId = workspaceId.split('/')[0] ?? workspaceId;
  const project = resolve(root, projectId);
  if (!contained(root, project)) throw new Error('workspace escapes root');
  await mkdir(project, { recursive: true, mode: 0o700 });
  const projectReal = await realpath(project);
  if (!contained(root, projectReal)) throw new Error('workspace escapes root');
  const stat = await lstat(projectReal); if (stat.isSymbolicLink()) throw new Error('workspace symlink rejected');
  const taskDir = resolve(projectReal, workspaceId.split('/').slice(1).join('/') || taskId);
  if (!contained(projectReal, taskDir)) throw new Error('workspace escapes project');
  await mkdir(taskDir, { recursive: true, mode: 0o700 });
  const actual = await realpath(taskDir);
  if (!contained(projectReal, actual)) throw new Error('workspace escapes project');
  const gitEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/home/ubuntu', LANG: 'C.UTF-8' };
  await execFileAsync('git', ['-C', actual, 'init', '--quiet'], { env: gitEnv });
  const branch = `task/${taskId.replace(/[^A-Za-z0-9._-]/g, '-')}`;
  const { stdout: currentBranch } = await execFileAsync('git', ['-C', actual, 'branch', '--show-current'], { env: gitEnv });
  if (currentBranch.trim() !== branch) await execFileAsync('git', ['-C', actual, 'checkout', '-B', branch], { env: gitEnv });
  return actual;
}
