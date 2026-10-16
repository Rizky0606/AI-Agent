import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMcpServerDefinitions } from '../src/index.ts';

test('parseMcpServerDefinitions returns nothing when MCP_SERVERS is unset or blank', () => {
  assert.deepEqual(parseMcpServerDefinitions(undefined), []);
  assert.deepEqual(parseMcpServerDefinitions(''), []);
  assert.deepEqual(parseMcpServerDefinitions('   '), []);
});

test('parseMcpServerDefinitions defaults the risk level to MEDIUM for an untrusted server', () => {
  const [definition] = parseMcpServerDefinitions(
    JSON.stringify([{ id: 'docs', command: 'npx', capability: 'docs:read' }]),
  );

  assert.deepEqual(definition, {
    config: {
      id: 'docs',
      name: 'docs',
      transport: 'stdio',
      allowedCapabilities: ['docs:read'],
      riskLevel: 'MEDIUM',
    },
    launch: { command: 'npx' },
    capability: 'docs:read',
  });
});

test('parseMcpServerDefinitions keeps launch details and normalizes the risk level', () => {
  const [definition] = parseMcpServerDefinitions(
    JSON.stringify([
      {
        id: 'fs-server',
        name: 'Filesystem MCP',
        command: '/usr/bin/node',
        args: ['server.js', '--root', '/srv'],
        env: { LOG_LEVEL: 'warn' },
        cwd: '/opt/mcp',
        capability: 'fs:read',
        riskLevel: 'high',
      },
    ]),
  );

  assert.equal(definition!.config.name, 'Filesystem MCP');
  assert.equal(definition!.config.riskLevel, 'HIGH');
  assert.deepEqual(definition!.config.allowedCapabilities, ['fs:read']);
  assert.deepEqual(definition!.launch, {
    command: '/usr/bin/node',
    args: ['server.js', '--root', '/srv'],
    env: { LOG_LEVEL: 'warn' },
    cwd: '/opt/mcp',
  });
});

test('parseMcpServerDefinitions rejects malformed input instead of silently registering nothing', () => {
  const cases: [string, RegExp][] = [
    ['not json', /bukan JSON yang valid/],
    ['{"id":"x"}', /harus berupa array JSON/],
    ['["docs"]', /MCP_SERVERS\[0\] harus berupa objek/],
    ['[{"command":"npx","capability":"docs:read"}]', /MCP_SERVERS\[0\]\.id wajib diisi/],
    ['[{"id":"docs","capability":"docs:read"}]', /MCP_SERVERS\[0\]\.command wajib diisi/],
    ['[{"id":"docs","command":"npx"}]', /MCP_SERVERS\[0\]\.capability wajib diisi/],
    ['[{"id":"docs","command":"npx","capability":"x","riskLevel":"EXTREME"}]', /riskLevel 'EXTREME' tidak dikenal/],
    ['[{"id":"docs","command":"npx","capability":"x","args":"--root"}]', /args harus berupa array string/],
    ['[{"id":"docs","command":"npx","capability":"x","args":[1]}]', /args harus berupa array string/],
    ['[{"id":"docs","command":"npx","capability":"x","env":"A=1"}]', /env harus berupa objek berisi string/],
    ['[{"id":"docs","command":"npx","capability":"x","env":{"A":1}}]', /env\.A harus berupa string/],
    ['[{"id":"  ","command":"npx","capability":"x"}]', /id wajib diisi/],
  ];

  for (const [raw, pattern] of cases) {
    assert.throws(() => parseMcpServerDefinitions(raw), pattern, `expected rejection for ${raw}`);
  }
});

test('parseMcpServerDefinitions parses every entry in a multi-server array', () => {
  const definitions = parseMcpServerDefinitions(
    JSON.stringify([
      { id: 'a', command: 'a-bin', capability: 'cap:a' },
      { id: 'b', command: 'b-bin', capability: 'cap:b', riskLevel: 'LOW' },
    ]),
  );

  assert.deepEqual(
    definitions.map((definition) => definition.config.id),
    ['a', 'b'],
  );
  assert.equal(definitions[0]!.config.riskLevel, 'MEDIUM');
  assert.equal(definitions[1]!.config.riskLevel, 'LOW');
});
