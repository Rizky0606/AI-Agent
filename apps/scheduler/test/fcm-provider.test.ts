import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { createFcmProviderFromEnv, HttpFcmProvider, ServiceAccountTokenSource } from '../src/fcm-provider.ts';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

interface RecordedRequest {
  url: string;
  authorization: string | undefined;
  body: string;
}

const startStubGoogle = async (
  recorded: RecordedRequest[],
  tokenResponses: Array<{ access_token?: string; expires_in?: number; status?: number }>,
): Promise<{ origin: string; close: () => Promise<void> }> => {
  let tokenCall = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      recorded.push({ url: req.url ?? '', authorization: req.headers.authorization, body });
      if (req.url === '/token') {
        const spec = tokenResponses[Math.min(tokenCall, tokenResponses.length - 1)];
        tokenCall += 1;
        const status = spec?.status ?? 200;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify(
            status === 200
              ? { access_token: spec?.access_token, expires_in: spec?.expires_in ?? 3600 }
              : { error: 'invalid_grant' },
          ),
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'projects/stub/messages/1' }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('stub server has no port');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

test('ServiceAccountTokenSource: menukar JWT service account menjadi access token dan mem-cache-nya', async () => {
  const recorded: RecordedRequest[] = [];
  const stub = await startStubGoogle(recorded, [{ access_token: 'token-real-1', expires_in: 3600 }]);

  try {
    const source = new ServiceAccountTokenSource({
      clientEmail: 'sender@project.iam.gserviceaccount.com',
      privateKey,
      tokenUri: `${stub.origin}/token`,
    });

    assert.equal(await source.getAccessToken(), 'token-real-1');
    assert.equal(await source.getAccessToken(), 'token-real-1');
    assert.equal(recorded.filter((r) => r.url === '/token').length, 1, 'token kedua harus dari cache');

    const assertion = new URLSearchParams(recorded[0]?.body).get('assertion');
    assert.ok(assertion);
    const [, claims] = assertion.split('.');
    const decoded = JSON.parse(Buffer.from(claims ?? '', 'base64url').toString()) as {
      iss: string;
      scope: string;
      aud: string;
    };
    assert.equal(decoded.iss, 'sender@project.iam.gserviceaccount.com');
    assert.equal(decoded.scope, 'https://www.googleapis.com/auth/firebase.messaging');
    assert.equal(decoded.aud, `${stub.origin}/token`);
  } finally {
    await stub.close();
  }
});

test('ServiceAccountTokenSource: menolak token kedaluwarsa dan gagal keras saat penukaran ditolak', async () => {
  const recorded: RecordedRequest[] = [];
  const stub = await startStubGoogle(recorded, [
    { access_token: 'token-short', expires_in: 30 },
    { status: 400 },
  ]);

  try {
    const source = new ServiceAccountTokenSource({
      clientEmail: 'sender@project.iam.gserviceaccount.com',
      privateKey,
      tokenUri: `${stub.origin}/token`,
    });

    // expires_in 30s < margin 60s, jadi token ini tidak boleh dipakai dari cache.
    assert.equal(await source.getAccessToken(), 'token-short');
    await assert.rejects(() => source.getAccessToken(), /HTTP 400/);
  } finally {
    await stub.close();
  }
});

test('HttpFcmProvider: mengirim ke FCM dengan bearer token dari token source, bukan literal', async () => {
  const recorded: RecordedRequest[] = [];
  const stub = await startStubGoogle(recorded, [{ access_token: 'token-real-2' }]);

  try {
    const provider = new HttpFcmProvider({
      projectId: 'personal-ai-os',
      baseUrl: `${stub.origin}/v1/projects/personal-ai-os/messages:send`,
      tokenSource: {
        getAccessToken: async () => 'token-real-2',
      },
    });

    const result = await provider.sendPushNotification('device-token-1', {
      title: 'Task selesai',
      body: 'Perintah selesai dengan exit code 0',
      data: { type: 'task_completed', deepLink: 'personal-ai://tasks/t-1', taskId: 't-1' },
    });

    assert.equal(result.success, true);
    assert.equal(recorded[0]?.authorization, 'Bearer token-real-2');
    const payload = JSON.parse(recorded[0]?.body ?? '{}') as { message?: { token?: string } };
    assert.equal(payload.message?.token, 'device-token-1');
  } finally {
    await stub.close();
  }
});

test('createFcmProviderFromEnv: service account tanpa kunci privat dinonaktifkan, bukan dikirim dengan token literal', () => {
  const previous = process.env.FCM_SERVICE_ACCOUNT_JSON;
  try {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'personal-ai-os' });
    const provider = createFcmProviderFromEnv();
    assert.equal(provider.constructor.name, 'DisabledFcmProvider');
  } finally {
    if (previous === undefined) {
      delete process.env.FCM_SERVICE_ACCOUNT_JSON;
    } else {
      process.env.FCM_SERVICE_ACCOUNT_JSON = previous;
    }
  }
});
