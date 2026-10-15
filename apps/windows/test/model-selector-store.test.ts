import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentStore } from '../src/state/agent-store.ts';
import { CapabilityRegistry } from '../src/security/capability-registry.ts';
import { PathValidator } from '../src/security/path-validator.ts';
import { DeviceIdentityManager } from '../src/connection/device-identity.ts';
import type { ICommandExecutor, CommandExecutionResult } from '../src/security/types.ts';
import type { ModelCatalogResponse } from '../src/api/client.ts';

// Mock localStorage for node environment
const storageMap = new Map<string, string>();
if (!globalThis.localStorage) {
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (key: string) => storageMap.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageMap.set(key, String(value));
    },
    removeItem: (key: string) => {
      storageMap.delete(key);
    },
    clear: () => {
      storageMap.clear();
    },
    key: (index: number) => Array.from(storageMap.keys())[index] ?? null,
    get length() {
      return storageMap.size;
    },
  };
}

class MockCommandExecutor implements ICommandExecutor {
  getCapabilityRegistry(): CapabilityRegistry {
    return new CapabilityRegistry();
  }
  getPathValidator(): PathValidator {
    return new PathValidator();
  }
  async executePowershell(): Promise<CommandExecutionResult> {
    return {
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      durationMs: 10,
      truncated: false,
      killedByTimeout: false,
      killedByAbort: false,
    };
  }
  cancelExecution(): void {}
  cancelAll(): void {}
}

const setupTestStore = () => {
  storageMap.clear();
  return createAgentStore(
    new CapabilityRegistry(),
    new PathValidator(),
    new DeviceIdentityManager(),
    new MockCommandExecutor(),
  );
};

test('Windows Store - Model Selection, Favorites, and Defaults', async () => {
  const useStore = setupTestStore();
  const store = useStore.getState();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/users/me/preferences') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as { defaultModel?: string };
      return new Response(JSON.stringify({
        defaultModel: body.defaultModel ?? null,
        defaultMode: 'auto',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    // Initial default
    assert.equal(store.selectedModel, 'auto');

    // Select a model
    await store.setConversationModel('gpt-4o');
    assert.equal(useStore.getState().selectedModel, 'gpt-4o');

    // Favorites toggle
    assert.equal(useStore.getState().favoriteModels.includes('gpt-4o'), false);
    store.toggleFavoriteModel('gpt-4o');
    assert.equal(useStore.getState().favoriteModels.includes('gpt-4o'), true);
    store.toggleFavoriteModel('gpt-4o');
    assert.equal(useStore.getState().favoriteModels.includes('gpt-4o'), false);

    // Set default model
    await store.setUserDefaultModel('claude-3-5-sonnet');
    assert.equal(useStore.getState().userDefaultModel, 'claude-3-5-sonnet');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Windows Store - Per-Conversation Persistence', async () => {
  const useStore = setupTestStore();
  const originalFetch = globalThis.fetch;
  let updatedPayload: Record<string, unknown> | null = null;
  let updatedConversationId: string | null = null;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/conversations/') && init?.method === 'PATCH') {
      const match = urlStr.match(/\/v1\/conversations\/([^/?]+)/);
      updatedConversationId = match?.[1] ?? null;
      updatedPayload = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ id: updatedConversationId, ...updatedPayload }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    // Add conversation to state first so setActiveConversation recognizes it
    useStore.setState({
      conversations: [
        { id: 'conv-1234', title: 'Test Conv', messages: [] },
      ],
      activeConversationId: 'conv-1234',
      authToken: 'valid-test-token',
    });

    await useStore.getState().setConversationModel('claude-3-5-sonnet');
    assert.equal(updatedConversationId, 'conv-1234');
    assert.deepEqual(updatedPayload, { model: 'claude-3-5-sonnet' });

    await useStore.getState().setConversationMode('coding');
    assert.equal(updatedConversationId, 'conv-1234');
    assert.deepEqual(updatedPayload, { mode: 'coding' });

    // Switch to auto resets model to null in backend
    await useStore.getState().setConversationModel('auto');
    assert.deepEqual(updatedPayload, { model: null });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Windows Store - Model Disappears from Catalog Reverts to Auto Gracefully', async () => {
  const useStore = setupTestStore();
  const store = useStore.getState();
  const originalFetch = globalThis.fetch;

  // Setup user with an active selection
  await store.setConversationModel('custom-deprecated-model');
  assert.equal(useStore.getState().selectedModel, 'custom-deprecated-model');

  // Next catalog refresh does NOT have custom-deprecated-model
  const mockCatalog: ModelCatalogResponse = {
    source: 'live',
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        capabilities: ['streaming'],
      },
      {
        id: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        capabilities: ['streaming', 'tools'],
      },
    ],
  };

  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/models')) {
      return new Response(JSON.stringify(mockCatalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    await store.refreshModels();

    // Check that selectedModel was gracefully reverted to 'auto'
    const current = useStore.getState();
    assert.equal(current.selectedModel, 'auto');
    assert.ok(current.modelNotice);
    assert.match(current.modelNotice, /custom-deprecated-model/);
    assert.match(current.modelNotice, /Auto/);

    // Notice can be cleared
    current.clearModelNotice();
    assert.equal(useStore.getState().modelNotice, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Windows Store - Catalog 503 Offline Handling', async () => {
  const useStore = setupTestStore();
  const store = useStore.getState();
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/models')) {
      return new Response(JSON.stringify({ error: 'Service Unavailable', code: 'GATEWAY_503' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    await store.refreshModels();

    const current = useStore.getState();
    assert.equal(current.modelCatalogUnavailable, true);
    assert.ok(current.modelCatalogError);
    // Auto remains operational
    assert.equal(current.selectedModel, 'auto');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Recovery when 503 recovers
  const healthyCatalog: ModelCatalogResponse = {
    source: 'live',
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        capabilities: ['streaming'],
      },
    ],
  };

  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes('/v1/models')) {
      return new Response(JSON.stringify(healthyCatalog), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    await store.refreshModels();
    const current = useStore.getState();
    assert.equal(current.modelCatalogUnavailable, false);
    assert.equal(current.modelCatalogError, null);
    assert.equal(current.models.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
