import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from '../src/api/client.ts';
import { deriveWsUrl, getInitialApiUrl, getInitialWsUrl } from '../src/api/config.ts';
import { FcmService } from '../src/services/fcm-service.ts';
import { InMemoryTokenStorage } from '../src/storage/secure-store.ts';

test('Config: derives WebSocket URLs and strips trailing slashes', () => {
  assert.equal(deriveWsUrl('http://10.0.2.2:3000'), 'ws://10.0.2.2:3000');
  assert.equal(deriveWsUrl('https://api.personal-ai.org'), 'wss://api.personal-ai.org');
  assert.equal(deriveWsUrl('http://api.personal-ai.org/'), 'ws://api.personal-ai.org');
  assert.equal(deriveWsUrl('https://api.personal-ai.org///'), 'wss://api.personal-ai.org');
});

test('Config: reads EXPO_PUBLIC environment variables when present', () => {
  const origApi = process.env['EXPO_PUBLIC_API_URL'];
  const origWs = process.env['EXPO_PUBLIC_WS_URL'];

  try {
    process.env['EXPO_PUBLIC_API_URL'] = 'https://custom-gateway.local:8443';
    process.env['EXPO_PUBLIC_WS_URL'] = 'wss://custom-gateway.local:8443/ws';

    assert.equal(getInitialApiUrl(), 'https://custom-gateway.local:8443');
    assert.equal(getInitialWsUrl(), 'wss://custom-gateway.local:8443/ws');

    const client = new ApiClient();
    assert.equal(client.getBaseUrl(), 'https://custom-gateway.local:8443');
    assert.equal(client.getBaseWsUrl(), 'wss://custom-gateway.local:8443/ws');
  } finally {
    if (origApi !== undefined) {
      process.env['EXPO_PUBLIC_API_URL'] = origApi;
    } else {
      delete process.env['EXPO_PUBLIC_API_URL'];
    }
    if (origWs !== undefined) {
      process.env['EXPO_PUBLIC_WS_URL'] = origWs;
    } else {
      delete process.env['EXPO_PUBLIC_WS_URL'];
    }
  }
});

test('ApiClient: setBaseUrl dynamically updates both HTTP and WSS endpoints', () => {
  const storage = new InMemoryTokenStorage();
  const client = new ApiClient({ storage, baseUrl: 'http://localhost:3000' });
  assert.equal(client.getBaseUrl(), 'http://localhost:3000');
  assert.equal(client.getBaseWsUrl(), 'ws://localhost:3000');

  // Change to HTTPS domain
  client.setBaseUrl('https://cloud.personal-ai.org');
  assert.equal(client.getBaseUrl(), 'https://cloud.personal-ai.org');
  assert.equal(client.getBaseWsUrl(), 'wss://cloud.personal-ai.org');

  // Change with explicit custom WSS endpoint
  client.setBaseUrl('https://proxy.personal-ai.org', 'wss://proxy.personal-ai.org/dedicated-ws');
  assert.equal(client.getBaseUrl(), 'https://proxy.personal-ai.org');
  assert.equal(client.getBaseWsUrl(), 'wss://proxy.personal-ai.org/dedicated-ws');
});

test('FCM Service: marks status clearly as inactive when credentials are missing', () => {
  const origFcmEnabled = process.env['EXPO_PUBLIC_FCM_ENABLED'];
  const origProject = process.env['EXPO_PUBLIC_FIREBASE_PROJECT_ID'];
  const origKey = process.env['EXPO_PUBLIC_FIREBASE_API_KEY'];

  try {
    delete process.env['EXPO_PUBLIC_FCM_ENABLED'];
    delete process.env['EXPO_PUBLIC_FIREBASE_PROJECT_ID'];
    delete process.env['EXPO_PUBLIC_FIREBASE_API_KEY'];

    const fcm = new FcmService();
    const status = fcm.getStatus();

    assert.equal(status.isConfigured, false);
    assert.equal(status.status, 'inactive');
    assert.match(status.reason, /FCM belum aktif/i);
    assert.match(status.reason, /google-services\.json/i);
  } finally {
    if (origFcmEnabled !== undefined) process.env['EXPO_PUBLIC_FCM_ENABLED'] = origFcmEnabled;
    if (origProject !== undefined) process.env['EXPO_PUBLIC_FIREBASE_PROJECT_ID'] = origProject;
    if (origKey !== undefined) process.env['EXPO_PUBLIC_FIREBASE_API_KEY'] = origKey;
  }
});

test('FCM Service: marks status as active when credentials are provided', () => {
  const fcmActive = new FcmService({ credentialsAvailable: true });
  const status = fcmActive.getStatus();

  assert.equal(status.isConfigured, true);
  assert.equal(status.status, 'active');
  assert.match(status.reason, /aktif/i);
});
