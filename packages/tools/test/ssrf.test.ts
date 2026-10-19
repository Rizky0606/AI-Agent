import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebFetchTool, SsrfGuard, SsrfViolationError, type DnsResolver } from '../src/index.ts';

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

test('SSRF Guard detects DNS rebinding using injected fake DNS resolver (zero-network deterministic)', async () => {
  const dnsTable: Record<string, string[]> = {
    'safe.example.com': ['93.184.216.34'],
    'rebinding-loopback.example.com': ['127.0.0.1'],
    'rebinding-private.example.com': ['10.0.0.1'],
    'rebinding-cloud.example.com': ['169.254.169.254'],
    'rebinding-ipv6.example.com': ['::1'],
    'rebinding-ipv6-unique.example.com': ['fc00::1'],
  };

  const fakeResolver: DnsResolver = async (hostname) => {
    const addresses = dnsTable[hostname];
    if (!addresses) {
      throw new Error(`ENOTFOUND: ${hostname}`);
    }
    return addresses.map((address) => ({ address }));
  };

  const guard = new SsrfGuard({
    resolveDns: true,
    dnsResolver: fakeResolver,
  });

  // 1. Safe domain resolving to public IP is allowed
  const safeRes = await guard.validateUrl('https://safe.example.com/api/v1');
  assert.equal(safeRes.safe, true);

  // 2. Domain resolving to loopback (127.0.0.1) is blocked
  const loopbackRes = await guard.validateUrl('https://rebinding-loopback.example.com/status');
  assert.equal(loopbackRes.safe, false);
  assert.match(loopbackRes.reason ?? '', /DNS rebinding|SSRF/i);

  // 3. Domain resolving to private subnet (10.0.0.1) is blocked
  const privateRes = await guard.validateUrl('https://rebinding-private.example.com/secret');
  assert.equal(privateRes.safe, false);
  assert.match(privateRes.reason ?? '', /DNS rebinding|SSRF/i);

  // 4. Domain resolving to cloud metadata (169.254.169.254) is blocked
  const cloudRes = await guard.validateUrl('https://rebinding-cloud.example.com/meta');
  assert.equal(cloudRes.safe, false);
  assert.match(cloudRes.reason ?? '', /DNS rebinding|SSRF/i);

  // 5. Domain resolving to IPv6 loopback (::1) is blocked
  const ipv6Res = await guard.validateUrl('https://rebinding-ipv6.example.com/admin');
  assert.equal(ipv6Res.safe, false);
  assert.match(ipv6Res.reason ?? '', /IPv6 internal|SSRF/i);

  // 6. Domain resolving to IPv6 unique local (fc00::1) is blocked
  const ipv6UniqueRes = await guard.validateUrl('https://rebinding-ipv6-unique.example.com/admin');
  assert.equal(ipv6UniqueRes.safe, false);
  assert.match(ipv6UniqueRes.reason ?? '', /IPv6 internal|SSRF/i);

  // 7. NXDOMAIN / unresolvable domain fails safe
  const unresolvableRes = await guard.validateUrl('https://unknown-nonexistent-domain.xyz/test');
  assert.equal(unresolvableRes.safe, false);
  assert.match(unresolvableRes.reason ?? '', /Gagal menyelesaikan DNS/i);
});

test('web_fetch: strictly blocks redirect to private IP or metadata (SSRF redirect protection)', async () => {
  const ssrfGuard = new SsrfGuard({ resolveDns: false });

  // Custom fetch mock simulating a 302 redirect from a public address to loopback/private
  const redirectFetchMock = async () => {
    return {
      status: 200,
      url: 'http://127.0.0.1:8080/admin/secrets',
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => 'leaked data',
    } as unknown as Response;
  };

  const fetchTool = createWebFetchTool(ssrfGuard, redirectFetchMock);

  await assert.rejects(
    async () =>
      fetchTool.execute(
        { url: 'https://public-service.com/redirect' },
        { actor: { id: 'user-1' } },
      ),
    (err: unknown) => err instanceof SsrfViolationError,
    'web_fetch harus melempar SsrfViolationError jika redirect mengarah ke IP privat',
  );
});

