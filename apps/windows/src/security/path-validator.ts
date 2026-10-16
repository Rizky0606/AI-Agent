export class SecurityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
  }
}

export function normalizeWindowsPath(targetPath: string): string {
  const normalized = targetPath.replace(/\//g, '\\');
  const driveMatch = normalized.match(/^([a-zA-Z]):(.*)$/);
  const drive = driveMatch ? driveMatch[1]!.toUpperCase() + ':' : '';
  const rest = driveMatch ? driveMatch[2]! : normalized;
  const parts = rest.split('\\').filter(Boolean);
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  if (drive) {
    return `${drive}\\${stack.join('\\')}`;
  }
  return stack.join('\\');
}

export class PathValidator {
  private allowedRoots: string[] = [];

  constructor(initialRoots?: string[]) {
    if (initialRoots) {
      for (const root of initialRoots) {
        this.addAllowedRoot(root);
      }
    }
  }

  addAllowedRoot(rootPath: string): void {
    this.assertSafePathFormat(rootPath);
    const normalized = this.normalize(rootPath);
    if (!this.allowedRoots.includes(normalized)) {
      this.allowedRoots.push(normalized);
    }
  }

  removeAllowedRoot(rootPath: string): void {
    const normalized = this.normalize(rootPath);
    this.allowedRoots = this.allowedRoots.filter((r) => r !== normalized);
  }

  getAllowedRoots(): string[] {
    return [...this.allowedRoots];
  }

  private normalize(targetPath: string): string {
    return normalizeWindowsPath(targetPath);
  }

  assertSafePathFormat(candidatePath: string): void {
    if (!candidatePath || typeof candidatePath !== 'string') {
      throw new SecurityError('INVALID_PATH', 'Path must be a non-empty string');
    }

    // 1. Reject Device namespaces (\\.\ or \\?\) and UNC paths (\\server\share)
    if (candidatePath.startsWith('\\\\')) {
      throw new SecurityError(
        'DEVICE_PATH_FORBIDDEN',
        `Device namespaces and UNC paths are strictly forbidden: "${candidatePath}"`,
      );
    }

    // 2. Reject Alternate Data Streams (e.g. file.txt:stream)
    // On Windows, the only allowed colon is for drive letters (e.g. C:\)
    const afterDrive = candidatePath.replace(/^[a-zA-Z]:[\\/]?/, '');
    if (afterDrive.includes(':')) {
      throw new SecurityError(
        'ALTERNATE_DATA_STREAM_FORBIDDEN',
        `Alternate data streams are strictly forbidden: "${candidatePath}"`,
      );
    }

    // 3. Reject null bytes
    if (candidatePath.includes('\0')) {
      throw new SecurityError('NULL_BYTE_DETECTED', 'Null bytes in path are strictly forbidden');
    }

    // 4. Reject encoded traversal and trailing dot/space
    const lowered = candidatePath.toLowerCase();
    if (lowered.includes('%2e')) {
      throw new SecurityError('PATH_TRAVERSAL_DETECTED', 'Encoded traversal components are forbidden');
    }
    if (candidatePath.endsWith('.') || candidatePath.endsWith(' ')) {
      throw new SecurityError('INVALID_PATH_FORMAT', 'Trailing dots and spaces are forbidden in path');
    }
  }

  assertPathAllowed(candidatePath: string): string {
    this.assertSafePathFormat(candidatePath);

    const resolved = this.normalize(candidatePath);

    // Path traversal check: verify the resolved path is actually within an allowed root
    if (this.allowedRoots.length === 0) {
      throw new SecurityError(
        'PATH_OUTSIDE_ALLOWLIST',
        `No directories in allowlist. Access denied to "${candidatePath}"`,
      );
    }

    const isAllowed = this.allowedRoots.some((root) => {
      // Must equal root OR start with root followed by path separator
      if (resolved === root) return true;
      const rootWithSep = root.endsWith('\\') ? root : root + '\\';
      return resolved.startsWith(rootWithSep);
    });

    if (!isAllowed) {
      throw new SecurityError(
        'PATH_OUTSIDE_ALLOWLIST',
        `Path "${candidatePath}" (resolved as "${resolved}") is outside all allowlisted roots: [${this.allowedRoots.join(', ')}]`,
      );
    }

    return resolved;
  }

  isPathAllowed(candidatePath: string): boolean {
    try {
      this.assertPathAllowed(candidatePath);
      return true;
    } catch {
      return false;
    }
  }
}
