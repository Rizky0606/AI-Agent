import assert from 'node:assert/strict';
import test from 'node:test';

function initializeGateway(env: Record<string, string | undefined>) {
  const isProduction = env['NODE_ENV'] === 'production';
  const modelGatewaySetting = env['MODEL_GATEWAY']?.toLowerCase();
  const nineRouterKey = env['NINEROUTER_API_KEY'] ?? env['NINE_ROUTER_API_KEY'];

  if (modelGatewaySetting === 'mock') {
    if (isProduction) {
      throw new Error(
        'FATAL CONFIGURATION ERROR: MODEL_GATEWAY=mock is forbidden in production environment. A live 9Router API key is required.',
      );
    }
    return { type: 'mock', warningLogged: true };
  } else if (!nineRouterKey || nineRouterKey.trim() === '') {
    if (isProduction) {
      throw new Error(
        'FATAL CONFIGURATION ERROR: NINEROUTER_API_KEY is required in production environment. Process terminated.',
      );
    }
    throw new Error(
      'NINEROUTER_API_KEY is missing. In development/testing, explicitly set MODEL_GATEWAY=mock to use MockModelGateway, or configure a valid NINEROUTER_API_KEY.',
    );
  } else {
    return { type: 'nine-router', apiKey: nineRouterKey };
  }
}

test('Gateway Security: Disallows silent fallback to mock gateway', () => {
  // 1. In production with no API key -> throws fatal error
  assert.throws(
    () => initializeGateway({ NODE_ENV: 'production', NINEROUTER_API_KEY: '' }),
    /FATAL CONFIGURATION ERROR: NINEROUTER_API_KEY is required in production environment/,
  );

  // 2. In production with MODEL_GATEWAY=mock -> throws fatal error
  assert.throws(
    () => initializeGateway({ NODE_ENV: 'production', MODEL_GATEWAY: 'mock' }),
    /FATAL CONFIGURATION ERROR: MODEL_GATEWAY=mock is forbidden in production environment/,
  );

  // 3. In development with missing API key and no MODEL_GATEWAY -> throws clear error
  assert.throws(
    () => initializeGateway({ NODE_ENV: 'development', NINEROUTER_API_KEY: undefined }),
    /NINEROUTER_API_KEY is missing.*explicitly set MODEL_GATEWAY=mock/,
  );

  // 4. In development with explicit MODEL_GATEWAY=mock -> allows mock with warning
  const mockRes = initializeGateway({ NODE_ENV: 'development', MODEL_GATEWAY: 'mock' });
  assert.equal(mockRes.type, 'mock');
  assert.equal(mockRes.warningLogged, true);

  // 5. In development with real API key -> allows 9Router
  const liveRes = initializeGateway({
    NODE_ENV: 'development',
    NINEROUTER_API_KEY: 'test-key-12345',
  });
  assert.equal(liveRes.type, 'nine-router');
  assert.equal(liveRes.apiKey, 'test-key-12345');
});
