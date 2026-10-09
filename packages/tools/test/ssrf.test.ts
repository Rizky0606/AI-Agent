import assert from 'node:assert/strict';
import test from 'node:test';
import { SsrfGuard, SsrfViolationError } from '../src/index.ts';

test('SSRF Guard strictly blocks loopback and private IPv4 addresses', async () => {
  const guard = new SsrfGuard({ resolveDns: false });

  const blockedUrls = [
    'http://127.0.0.1/',
    'http://127.0.0.1:8080/admin',
    'http://127.0.1.1/',
    'http://10.0.0.1/internal',
    'http://10.254.1.1:3000/api',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.0.1/router',
    'http://192.168.1.254/',
    'http://0.0.0.0/',
  ];

  for (const url of blockedUrls) {
    const result = await guard.validateUrl(url);
    assert.equal(result.safe, false, `URL ${url} harusnya diblokir`);
    assert.match(result.reason ?? '', /privat|internal|SSRF/i);

    await assert.rejects(
      async () => guard.assertSafeUrl(url),
      (err: unknown) => err instanceof SsrfViolationError,
      `URL ${url} harus melempar SsrfViolationError`,
    );
  }
});

test('SSRF Guard strictly blocks cloud metadata IPs and hostnames', async () => {
  const guard = new SsrfGuard({ resolveDns: false });

  const metadataUrls = [
    // AWS / Azure / GCP / Oracle Cloud metadata IP
    'http://169.254.169.254/latest/meta-data/',
    'http://169.254.169.254/opc/v1/instance/',
    // Alibaba Cloud metadata IP
    'http://100.100.100.200/latest/meta-data/',
    // Google Cloud metadata hostname
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://metadata/computeMetadata/v1/',
    'http://instance-data/latest/meta-data/',
    'http://metadata.azure.com/metadata/instance',
  ];

  for (const url of metadataUrls) {
    const result = await guard.validateUrl(url);
    assert.equal(result.safe, false, `Metadata URL ${url} harus diblokir`);
    assert.match(result.reason ?? '', /metadata|cloud|privat/i);

    await assert.rejects(
      async () => guard.assertSafeUrl(url),
      (err: unknown) => err instanceof SsrfViolationError,
    );
  }
});

test('SSRF Guard strictly blocks IPv6 loopback, link-local, and unique-local', async () => {
  const guard = new SsrfGuard({ resolveDns: false });

  const ipv6Blocked = [
    'http://[::1]/',
    'http://[::1]:8080/status',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456:789a::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
  ];

  for (const url of ipv6Blocked) {
    const result = await guard.validateUrl(url);
    assert.equal(result.safe, false, `IPv6 URL ${url} harus diblokir`);
    await assert.rejects(async () => guard.assertSafeUrl(url));
  }
});

test('SSRF Guard strictly blocks localhost and aliases', async () => {
  const guard = new SsrfGuard({ resolveDns: false });

  const localhostUrls = [
    'http://localhost/',
    'http://localhost:3000/api',
    'http://sub.localhost/',
    'http://localtest.me/',
  ];

  for (const url of localhostUrls) {
    const result = await guard.validateUrl(url);
    assert.equal(result.safe, false, `Localhost URL ${url} harus diblokir`);
    await assert.rejects(async () => guard.assertSafeUrl(url));
  }
});

test('SSRF Guard enforces domain deny list', async () => {
  const guard = new SsrfGuard({
    deniedDomains: ['evil.com', 'tracker.net', 'malware.example'],
    resolveDns: false,
  });

  const res1 = await guard.validateUrl('https://evil.com/payload');
  assert.equal(res1.safe, false);
  assert.match(res1.reason ?? '', /daftar blokir/i);

  const res2 = await guard.validateUrl('https://sub.evil.com/test');
  assert.equal(res2.safe, false);
  assert.match(res2.reason ?? '', /daftar blokir/i);

  const res3 = await guard.validateUrl('https://tracker.net/');
  assert.equal(res3.safe, false);

  // Allowed public domain passes
  const resAllowed = await guard.validateUrl('https://api.github.com/repos');
  assert.equal(resAllowed.safe, true);
});

test('SSRF Guard rejects non-HTTP protocols', async () => {
  const guard = new SsrfGuard({ resolveDns: false });

  const nonHttpUrls = [
    'file:///etc/passwd',
    'ftp://files.example.com/data',
    'gopher://gopher.floodgap.com/',
    'javascript:alert(1)',
  ];

  for (const url of nonHttpUrls) {
    const res = await guard.validateUrl(url);
    assert.equal(res.safe, false);
    assert.match(res.reason ?? '', /protokol/i);
  }
});
