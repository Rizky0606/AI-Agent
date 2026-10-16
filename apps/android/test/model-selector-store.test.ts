import assert from 'node:assert/strict';
import test from 'node:test';
import { useChatStore } from '../src/state/chat-store.ts';
import { defaultApiClient } from '../src/api/client.ts';
import type { ModelCatalogResponse } from '../src/api/types.ts';

test('Android Store - Model Selection, Favorites, and Defaults', async () => {
  const store = useChatStore.getState();

  // Initial default
  assert.equal(store.selectedModel, 'auto');

  // Select a model
  await store.setConversationModel('gpt-4o');
  assert.equal(useChatStore.getState().selectedModel, 'gpt-4o');

  // Toggle favorite
  assert.equal(useChatStore.getState().favoriteModels.includes('gpt-4o'), false);
  store.toggleFavoriteModel('gpt-4o');
  assert.equal(useChatStore.getState().favoriteModels.includes('gpt-4o'), true);
  store.toggleFavoriteModel('gpt-4o');
  assert.equal(useChatStore.getState().favoriteModels.includes('gpt-4o'), false);
});

test('Android Store - Per-Conversation Persistence', async () => {
  const store = useChatStore.getState();
  let updatedConversationId: string | null = null;
  let updatedPayload: Record<string, unknown> | null = null;

  // Mock updateConversation on defaultApiClient
  const origUpdate = defaultApiClient.updateConversation.bind(defaultApiClient);
  defaultApiClient.updateConversation = async (
    id: string,
    updates: string | { title?: string | undefined; model?: string | null | undefined; mode?: string | undefined },
  ) => {
    updatedConversationId = id;
    const updObj = typeof updates === 'string' ? { title: updates } : updates;
    updatedPayload = updObj;
    return {
      conversation: {
        id,
        userId: 'user-1',
        projectId: null,
        title: updObj.title ?? 'Test',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };
  };

  try {
    store.setConversationId('android-conv-123');

    await store.setConversationModel('claude-3-5-sonnet');
    assert.equal(updatedConversationId, 'android-conv-123');
    assert.deepEqual(updatedPayload, { model: 'claude-3-5-sonnet' });

    await store.setConversationMode('coding');
    assert.equal(updatedConversationId, 'android-conv-123');
    assert.deepEqual(updatedPayload, { mode: 'coding' });

    // Switching to auto sends null model
    await store.setConversationModel('auto');
    assert.deepEqual(updatedPayload, { model: null });
  } finally {
    defaultApiClient.updateConversation = origUpdate;
  }
});

test('Android Store - Model Disappears from Catalog Reverts to Auto Gracefully', async () => {
  const store = useChatStore.getState();

  await store.setConversationModel('discontinued-model-v1');
  assert.equal(useChatStore.getState().selectedModel, 'discontinued-model-v1');

  const origList = defaultApiClient.listModels.bind(defaultApiClient);
  const origPref = defaultApiClient.getUserPreferences.bind(defaultApiClient);

  defaultApiClient.listModels = async (): Promise<ModelCatalogResponse> => {
    return {
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
  };

  defaultApiClient.getUserPreferences = async () => ({
    userId: 'user-1',
    defaultModel: 'gpt-4o',
    defaultMode: 'fast',
    theme: 'system',
    notificationsEnabled: true,
  });

  try {
    await store.loadCatalog();

    const current = useChatStore.getState();
    assert.equal(current.selectedModel, 'auto');
    assert.ok(current.modelNotice);
    assert.match(current.modelNotice, /discontinued-model-v1/);
    assert.match(current.modelNotice, /Auto/);

    current.clearModelNotice();
    assert.equal(useChatStore.getState().modelNotice, null);
  } finally {
    defaultApiClient.listModels = origList;
    defaultApiClient.getUserPreferences = origPref;
  }
});

test('Android Store - Catalog 503 Handling', async () => {
  const store = useChatStore.getState();

  const origList = defaultApiClient.listModels.bind(defaultApiClient);
  defaultApiClient.listModels = async () => {
    throw new Error('503 Service Unavailable: Gateway failure');
  };

  try {
    await store.loadCatalog();

    const current = useChatStore.getState();
    assert.equal(current.modelCatalogUnavailable, true);
    assert.ok(current.modelCatalogError);
    assert.equal(current.selectedModel, 'auto');
  } finally {
    defaultApiClient.listModels = origList;
  }

  // Recovery
  defaultApiClient.listModels = async (): Promise<ModelCatalogResponse> => ({
    source: 'live',
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: 'openai',
        capabilities: ['streaming'],
      },
    ],
  });

  try {
    await store.loadCatalog();
    const current = useChatStore.getState();
    assert.equal(current.modelCatalogUnavailable, false);
    assert.equal(current.modelCatalogError, null);
    assert.equal(current.models.length, 1);
  } finally {
    defaultApiClient.listModels = origList;
  }
});
