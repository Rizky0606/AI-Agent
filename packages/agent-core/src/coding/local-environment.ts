import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { CodingEnvironment } from './coding-agent.ts';

const execFileAsync = promisify(execFile);

/** Absolute path of the directory, or the reason it is not inside the workspace. */
function containment(root: string, candidate: string): string | undefined {
  const inside = relative(root, candidate);
  if (inside === '') return undefined;
  if (inside.startsWith('..') || isAbsolute(inside)) return inside;
  return undefined;
}

export interface CodingCheckCommands {
  lint: readonly string[];
  typecheck: readonly string[];
  test: readonly string[];
  build: readonly string[];
}

/**
 * The checks run the workspace's own package scripts. `node --run` is used instead of a package
 * manager so the worker needs neither pnpm nor a registry download to verify a task. A workspace
 * without the script fails the check, which is the honest answer — there is no evidence of that
 * check passing.
 */
export const DEFAULT_CODING_CHECKS: CodingCheckCommands = {
  lint: ['node', '--run', 'lint'],
  typecheck: ['node', '--run', 'typecheck'],
  test: ['node', '--run', 'test'],
  build: ['node', '--run', 'build'],
};

export interface LocalCodingEnvironmentOptions {
  workspaceDir: string;
  commands?: Partial<CodingCheckCommands> | undefined;
  /** Wall-clock limit per check. A check that never returns must not hold the task forever. */
  checkTimeoutMs?: number | undefined;
  /** Evidence is stored in task artifacts, so command output is bounded before it is kept. */
  maxOutputChars?: number | undefined;
}

interface CheckOutcome {
  passed: boolean;
  output: string;
}

/**
 * Executes the coding workflow against a real directory: git for status/branch/diff and the
 * configured commands for lint, typecheck, test, and build. Nothing here reports success without
 * having run something.
 */
export class LocalCodingEnvironment implements CodingEnvironment {
  private readonly workspaceDir: string;
  private readonly commands: CodingCheckCommands;
  private readonly checkTimeoutMs: number;
  private readonly maxOutputChars: number;

  constructor(options: LocalCodingEnvironmentOptions) {
    this.workspaceDir = resolve(options.workspaceDir);
    this.commands = { ...DEFAULT_CODING_CHECKS, ...options.commands };
    this.checkTimeoutMs = options.checkTimeoutMs ?? 300_000;
    this.maxOutputChars = options.maxOutputChars ?? 16_000;
  }

  /**
   * The workspace is a bind mount owned by the host user, while the worker runs as its own
   * unprivileged user, so git refuses the repository as "dubious ownership". The exception is
   * scoped to this one directory — never a blanket `safe.directory=*`.
   */
  private get gitEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: this.workspaceDir,
    };
  }

  private async git(args: readonly string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', this.workspaceDir, ...args], {
      timeout: this.checkTimeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      env: this.gitEnv,
    });
    return stdout;
  }

  private resolveInside(filePath: string): string {
    const target = resolve(this.workspaceDir, filePath);
    const escape = containment(this.workspaceDir, target);
    if (escape !== undefined) {
      throw new Error(`Coding file path escapes the workspace: ${filePath}`);
    }
    return target;
  }

  private async runCheck(argv: readonly string[]): Promise<CheckOutcome> {
    const [file, ...args] = argv;
    if (!file) return { passed: false, output: 'No command configured for this check.' };
    try {
      const { stdout, stderr } = await execFileAsync(file, args, {
        cwd: this.workspaceDir,
        timeout: this.checkTimeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, CI: '1' },
      });
      return { passed: true, output: this.bound(`${stdout}${stderr}`) };
    } catch (err) {
      const failure = err as { stdout?: string; stderr?: string; killed?: boolean; message?: string };
      const output = `${failure.stdout ?? ''}${failure.stderr ?? ''}`;
      const reason = failure.killed
        ? `Command timed out after ${this.checkTimeoutMs}ms: ${argv.join(' ')}`
        : `Command failed: ${argv.join(' ')}`;
      return { passed: false, output: this.bound(output.length > 0 ? output : reason) };
    }
  }

  private bound(text: string): string {
    if (text.length <= this.maxOutputChars) return text;
    return `${text.slice(0, this.maxOutputChars)}\n[output truncated at ${this.maxOutputChars} characters]`;
  }

  async getGitStatus(): Promise<{ clean: boolean; branch: string; uncommittedFiles: string[] }> {
    const [porcelain, branch] = await Promise.all([
      this.git(['status', '--porcelain']),
      this.git(['branch', '--show-current']),
    ]);
    const lines = porcelain.split('\n').filter((line) => line.trim().length > 0);
    return {
      clean: lines.length === 0,
      branch: branch.trim(),
      uncommittedFiles: lines.map((line) => line.slice(3).trim()),
    };
  }

  async createIsolatedBranch(branchName: string): Promise<void> {
    try {
      await this.git(['checkout', '-b', branchName]);
    } catch {
      // The branch already exists from an earlier attempt on this task.
      await this.git(['checkout', branchName]);
    }
  }

  async readFile(filePath: string): Promise<string> {
    return readFile(this.resolveInside(filePath), 'utf8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const target = this.resolveInside(filePath);
    const parent = dirname(target);
    await mkdir(parent, { recursive: true });
    // A symlink inside the workspace must not redirect the write outside it.
    const realParent = await realpath(parent);
    const escape = containment(await realpath(this.workspaceDir), realParent);
    if (escape !== undefined) {
      throw new Error(`Coding file path escapes the workspace: ${filePath}`);
    }
    await writeFile(target, content, 'utf8');
  }

  async runLint(): Promise<{ passed: boolean; output: string }> {
    return this.runCheck(this.commands.lint);
  }

  async runTypecheck(): Promise<{ passed: boolean; output: string }> {
    return this.runCheck(this.commands.typecheck);
  }

  async runTests(): Promise<{
    passed: boolean;
    passedCount?: number | undefined;
    failedCount?: number | undefined;
    output: string;
  }> {
    const outcome = await this.runCheck(this.commands.test);
    // `node --test` prints TAP counters. When a suite does not, report no counts rather than
    // inventing them; the evaluator keys off `passed` alone in that case.
    const passedCount = Number(/# pass (\d+)/.exec(outcome.output)?.[1]);
    const failedCount = Number(/# fail (\d+)/.exec(outcome.output)?.[1]);
    return {
      passed: outcome.passed,
      ...(Number.isNaN(passedCount) ? {} : { passedCount }),
      ...(Number.isNaN(failedCount) ? {} : { failedCount }),
      output: outcome.output,
    };
  }

  async runBuild(): Promise<{ passed: boolean; output: string }> {
    return this.runCheck(this.commands.build);
  }

  async getDiff(): Promise<{ diffSummary: string; fullDiff: string; changedFiles: string[] }> {
    // Intent-to-add makes files the agent just created appear in `git diff` without staging
    // their content; without it a brand-new file is invisible to the diff and to the evaluator.
    await this.git(['add', '--intent-to-add', '.']);
    const [stat, full, names] = await Promise.all([
      this.git(['diff', '--stat']),
      this.git(['diff']),
      this.git(['diff', '--name-only']),
    ]);
    return {
      diffSummary: this.bound(stat.trim()),
      fullDiff: this.bound(full),
      changedFiles: names.split('\n').filter((line) => line.trim().length > 0),
    };
  }
}

/**
 * Creates (or reuses) the directory a coding task writes into, and makes it a git repository so
 * the agent can inspect status and produce a diff. Containment is enforced before anything is
 * created, so a task id can never steer the path.
 */
export async function prepareCodingWorkspace(rootInput: string, taskId: string): Promise<string> {
  const root = resolve(rootInput);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootReal = await realpath(root);

  const safeTaskId = taskId.replace(/[^A-Za-z0-9._-]/g, '-');
  if (safeTaskId.length === 0) throw new Error('Coding workspace requires a usable task id.');
  const dir = resolve(rootReal, safeTaskId);
  if (containment(rootReal, dir) !== undefined) {
    throw new Error(`Coding workspace escapes its root: ${taskId}`);
  }

  await mkdir(dir, { recursive: true, mode: 0o700 });
  const dirReal = await realpath(dir);
  if (containment(rootReal, dirReal) !== undefined) {
    throw new Error(`Coding workspace escapes its root: ${taskId}`);
  }

  const gitEnv = {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'safe.directory',
    GIT_CONFIG_VALUE_0: dirReal,
  };
  try {
    await execFileAsync('git', ['-C', dirReal, 'rev-parse', '--git-dir'], { env: gitEnv });
  } catch {
    await execFileAsync('git', ['-C', dirReal, 'init', '--quiet'], { env: gitEnv });
  }
  return dirReal;
}
