import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { PathValidator, SecurityError } from '../src/security/path-validator.ts';

test('PathValidator: Path outside allowlist is rejected', () => {
  const validator = new PathValidator(['C:\\AllowedWorkspace']);

  assert.throws(
    () => {
      validator.assertPathAllowed('C:\\Windows\\System32\\cmd.exe');
    },
    (err: unknown) => {
      assert.ok(err instanceof SecurityError);
      assert.equal(err.code, 'PATH_OUTSIDE_ALLOWLIST');
      return true;
    },
  );
});

test('PathValidator: Path traversal attempts (..) are strictly rejected', () => {
  const allowedRoot = 'C:\\AllowedWorkspace';
  const validator = new PathValidator([allowedRoot]);

  // Attempting to step out of the allowed root using parent directory traversal
  const traversalPath = path.win32.join(allowedRoot, '..', '..', 'Windows', 'System32');

  assert.throws(
    () => {
      validator.assertPathAllowed(traversalPath);
    },
    (err: unknown) => {
      assert.ok(err instanceof SecurityError);
      assert.equal(err.code, 'PATH_OUTSIDE_ALLOWLIST');
      return true;
    },
  );
});

test('PathValidator: Alternate Data Streams (ADS) are rejected', () => {
  const validator = new PathValidator(['C:\\AllowedWorkspace']);

  assert.throws(
    () => {
      validator.assertPathAllowed('C:\\AllowedWorkspace\\file.txt:hidden_stream');
    },
    (err: unknown) => {
      assert.ok(err instanceof SecurityError);
      assert.equal(err.code, 'ALTERNATE_DATA_STREAM_FORBIDDEN');
      return true;
    },
  );
});

test('PathValidator: Device namespaces (\\\\.\\ and \\\\?\\) are rejected', () => {
  const validator = new PathValidator(['C:\\AllowedWorkspace']);

  assert.throws(
    () => {
      validator.assertPathAllowed('\\\\.\\PhysicalDrive0');
    },
    (err: unknown) => {
      assert.ok(err instanceof SecurityError);
      assert.equal(err.code, 'DEVICE_PATH_FORBIDDEN');
      return true;
    },
  );

  assert.throws(
    () => {
      validator.assertPathAllowed('\\\\?\\C:\\Windows');
    },
    (err: unknown) => {
      assert.ok(err instanceof SecurityError);
      assert.equal(err.code, 'DEVICE_PATH_FORBIDDEN');
      return true;
    },
  );
});

test('PathValidator: Valid subpaths and exact roots in allowlist are accepted', () => {
  const allowedRoot = 'C:\\AllowedWorkspace';
  const validator = new PathValidator([allowedRoot]);

  const exact = validator.assertPathAllowed('C:\\AllowedWorkspace');
  assert.equal(exact, allowedRoot);

  const subpath = validator.assertPathAllowed('C:\\AllowedWorkspace\\src\\index.ts');
  assert.ok(subpath.startsWith(allowedRoot));
  assert.equal(validator.isPathAllowed('C:\\AllowedWorkspace\\package.json'), true);
  assert.equal(validator.isPathAllowed('D:\\OtherDrive\\file.txt'), false);
});
