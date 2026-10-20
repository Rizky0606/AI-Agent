import { mkdir, lstat, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, relative, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

const SAFE_SEGMENT_REGEX = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * Checks whether candidate is strictly contained within root.
 * Handles Windows case-insensitivity, trailing separators, and traversal attempts.
 */
export function contained(root: string, candidate: string): boolean {
  const normRoot = resolve(root);
  const normCandidate = resolve(candidate);
  const sep = process.platform === 'win32' ? '\\' : '/';
  const rootWithSep = normRoot.endsWith(sep) ? normRoot : `${normRoot}${sep}`;

  if (process.platform === 'win32') {
    const rootLower = normRoot.toLowerCase();
    const candLower = normCandidate.toLowerCase();
    const rootWithSepLower = rootWithSep.toLowerCase();
    if (candLower !== rootLower && !candLower.startsWith(rootWithSepLower)) {
      return false;
    }
  } else {
    if (normCandidate !== normRoot && !normCandidate.startsWith(rootWithSep)) {
      return false;
    }
  }

  const rel = relative(normRoot, normCandidate);
  if (rel === '' || rel === '.') return true;
  return !rel.startsWith('..') && !isAbsolute(rel);
}

function safeSegment(segment: string): boolean {
  return segment.length > 0 && segment.length <= 128 && SAFE_SEGMENT_REGEX.test(segment);
}

function validateWorkspaceId(workspaceId: string): string[] {
  if (
    !workspaceId ||
    workspaceId.length > 256 ||
    workspaceId.includes('\0') ||
    workspaceId.includes('\\') ||
    workspaceId.includes(':') ||
    isAbsolute(workspaceId)
  ) {
    throw new Error('invalid workspaceId');
  }

  const segments = workspaceId.split('/');
  if (segments.length === 0 || segments.length > 4 || !segments.every(safeSegment)) {
    throw new Error('invalid workspaceId');
  }
  return segments;
}

function validateTaskId(taskId: string): string {
  if (
    !taskId ||
    taskId.length > 128 ||
    taskId.includes('\0') ||
    taskId.includes('/') ||
    taskId.includes('\\') ||
    taskId.includes(':') ||
    !safeSegment(taskId)
  ) {
    throw new Error('invalid taskId');
  }
  return taskId;
}

export async function prepareWorkspace(rootInput: string, workspaceId: string, taskId: string): Promise<string> {
  const segments = validateWorkspaceId(workspaceId);
  const validTaskId = validateTaskId(taskId);

  await mkdir(rootInput, { recursive: true, mode: 0o700 });
  const root = await realpath(rootInput);

  const projectId = segments[0]!;
  const project = resolve(root, projectId);
  if (!contained(root, project)) throw new Error('workspace escapes root');

  // Verify project path before mkdir if it exists
  try {
    const existingStat = await lstat(project);
    if (existingStat.isSymbolicLink()) throw new Error('workspace symlink rejected');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  await mkdir(project, { recursive: true, mode: 0o700 });
  const projectReal = await realpath(project);
  if (!contained(root, projectReal)) throw new Error('workspace escapes root');
  const projectStat = await lstat(projectReal);
  if (projectStat.isSymbolicLink()) throw new Error('workspace symlink rejected');

  const subPath = segments.slice(1).join('/') || validTaskId;
  const taskDir = resolve(projectReal, subPath);
  if (!contained(projectReal, taskDir)) throw new Error('workspace escapes project');

  // Verify taskDir before mkdir if it exists
  try {
    const existingTaskStat = await lstat(taskDir);
    if (existingTaskStat.isSymbolicLink()) throw new Error('workspace symlink rejected');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  await mkdir(taskDir, { recursive: true, mode: 0o700 });
  const actual = await realpath(taskDir);
  if (!contained(projectReal, actual)) throw new Error('workspace escapes project');
  const taskStat = await lstat(actual);
  if (taskStat.isSymbolicLink()) throw new Error('workspace symlink rejected');

  const sep = process.platform === 'win32' ? ';' : ':';
  const defaultPath = process.platform === 'win32' ? (process.env.PATH ?? '') : '/usr/bin:/bin';
  const gitEnv: NodeJS.ProcessEnv = {
    PATH: `${process.env.RUNTIME_BIN_DIR ?? ''}${sep}${defaultPath}`,
    HOME: process.env.HOME ?? (process.platform === 'win32' ? (process.env.USERPROFILE ?? 'C:\\') : '/home/ubuntu'),
    LANG: 'C.UTF-8',
    SYSTEMROOT: process.env.SYSTEMROOT,
    COMSPEC: process.env.COMSPEC,
  };

  await execFileAsync('git', ['-C', actual, 'init', '--quiet'], { env: gitEnv });
  const branch = `task/${validTaskId.replace(/[^A-Za-z0-9._-]/g, '-')}`;
  const { stdout: currentBranch } = await execFileAsync('git', ['-C', actual, 'branch', '--show-current'], { env: gitEnv });
  if (currentBranch.trim() !== branch) {
    await execFileAsync('git', ['-C', actual, 'checkout', '-B', branch], { env: gitEnv });
  }

  return actual;
}
