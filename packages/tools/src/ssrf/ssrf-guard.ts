import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class SsrfViolationError extends Error {
  readonly url: string;
  readonly reason: string;

  constructor(url: string, reason: string) {
    super(`SSRF Protection: Permintaan ke '${url}' diblokir. Alasan: ${reason}`);
    this.name = 'SsrfViolationError';
    this.url = url;
    this.reason = reason;
  }
}

export interface DnsLookupRecord {
  address: string;
  family?: number | undefined;
}

export type DnsResolver = (hostname: string) => Promise<Array<DnsLookupRecord | string>>;

export interface SsrfGuardOptions {
  allowedDomains?: string[] | undefined;
  deniedDomains?: string[] | undefined;
  allowPrivateForTesting?: boolean | undefined;
  resolveDns?: boolean | undefined;
  dnsResolver?: DnsResolver | undefined;
}

const METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata',
  'instance-data',
  'metadata.azure.com',
  '169.254.169.254',
  '100.100.100.200',
]);

/**
 * Checks if an IPv4 integer representation falls within private or reserved IP ranges.
 */
function isPrivateIPv4(ipNum: number): boolean {
  // 0.0.0.0/8
  if ((ipNum & 0xff000000) >>> 0 === 0x00000000) return true;
  // 10.0.0.0/8
  if ((ipNum & 0xff000000) >>> 0 === 0x0a000000) return true;
  // 127.0.0.0/8 (Loopback)
  if ((ipNum & 0xff000000) >>> 0 === 0x7f000000) return true;
  // 169.254.0.0/16 (Link-Local & Cloud Metadata)
  if ((ipNum & 0xffff0000) >>> 0 === 0xa9fe0000) return true;
  // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
  if ((ipNum & 0xfff00000) >>> 0 === 0xac100000) return true;
  // 192.168.0.0/16
  if ((ipNum & 0xffff0000) >>> 0 === 0xc0a80000) return true;
  // 100.64.0.0/10 (Carrier-Grade NAT / Cloud Internal)
  if ((ipNum & 0xffc00000) >>> 0 === 0x64400000) return true;
  // 224.0.0.0/4 (Multicast)
  if ((ipNum & 0xf0000000) >>> 0 === 0xe0000000) return true;
  // 240.0.0.0/4 (Reserved)
  if ((ipNum & 0xf0000000) >>> 0 === 0xf0000000) return true;
  // 255.255.255.255 (Broadcast)
  if (ipNum === 0xffffffff) return true;

  return false;
}

/**
 * Parses numeric IPv4 representation (standard dot-decimal, octal, hex, or integer).
 */
function parseIPv4ToNumber(host: string): number | null {
  // Standard 4 octets
  const parts = host.split('.');
  if (parts.length === 4) {
    let result = 0;
    for (let i = 0; i < 4; i++) {
      const part = parts[i]!;
      let num: number;
      if (part.startsWith('0x') || part.startsWith('0X')) {
        num = parseInt(part, 16);
      } else if (part.startsWith('0') && part.length > 1) {
        num = parseInt(part, 8);
      } else {
        num = parseInt(part, 10);
      }
      if (isNaN(num) || num < 0 || num > 255) return null;
      result = ((result << 8) | num) >>> 0;
    }
    return result;
  }

  // Single integer or hex (e.g. 2130706433 or 0x7f000001)
  if (/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(host)) {
    const num =
      host.startsWith('0x') || host.startsWith('0X') ? parseInt(host, 16) : parseInt(host, 10);
    if (!isNaN(num) && num >= 0 && num <= 0xffffffff) {
      return num >>> 0;
    }
  }

  return null;
}

/**
 * Validates IPv6 addresses for local, loopback, unique local, or IPv4-mapped private ranges.
 */
function isPrivateIPv6(host: string): boolean {
  const clean = host.replace(/^\[|\]$/g, '').toLowerCase();

  // Loopback
  if (clean === '::1' || clean === '0:0:0:0:0:0:0:1') return true;
  // Unspecified
  if (clean === '::' || clean === '0:0:0:0:0:0:0:0') return true;

  // Unique local addresses fc00::/7 (fc.. or fd..)
  if (clean.startsWith('fc') || clean.startsWith('fd')) return true;

  // Link-local unicast fe80::/10 (fe8, fe9, fea, feb)
  if (/^fe[89ab]/i.test(clean)) return true;

  // IPv4-mapped IPv6 (::ffff:127.0.0.1 or normalized ::ffff:7f00:1)
  if (clean.startsWith('::ffff:') || clean.startsWith('0:0:0:0:0:ffff:')) {
    const rest = clean.replace(/^(::ffff:|0:0:0:0:0:ffff:)/, '');
    if (rest.includes('.')) {
      const num = parseIPv4ToNumber(rest);
      if (num !== null) return isPrivateIPv4(num);
    } else if (rest.includes(':')) {
      const hexParts = rest.split(':');
      if (hexParts.length === 2) {
        const high = parseInt(hexParts[0]!, 16);
        const low = parseInt(hexParts[1]!, 16);
        if (!isNaN(high) && !isNaN(low)) {
          const ipNum = ((high << 16) | low) >>> 0;
          return isPrivateIPv4(ipNum);
        }
      }
    }
  }

  return false;
}

export class SsrfGuard {
  private readonly allowedDomains: Set<string>;
  private readonly deniedDomains: Set<string>;
  private readonly allowPrivateForTesting: boolean;
  private readonly resolveDns: boolean;
  private readonly dnsResolver?: DnsResolver | undefined;

  constructor(options?: SsrfGuardOptions) {
    this.allowedDomains = new Set(
      (options?.allowedDomains ?? []).map((d) => d.toLowerCase().trim()),
    );
    this.deniedDomains = new Set((options?.deniedDomains ?? []).map((d) => d.toLowerCase().trim()));
    this.allowPrivateForTesting = options?.allowPrivateForTesting ?? false;
    this.resolveDns = options?.resolveDns ?? true;
    this.dnsResolver = options?.dnsResolver;
  }

  /**
   * Evaluates if a given URL string is safe from SSRF and allowed by policy.
   */
  async validateUrl(urlString: string): Promise<{ safe: boolean; reason?: string }> {
    let url: URL;
    try {
      url = new URL(urlString);
    } catch {
      return { safe: false, reason: 'URL tidak valid atau format malformed.' };
    }

    // 1. Protocol check: only http and https are allowed
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        safe: false,
        reason: `Protokol '${url.protocol}' tidak diizinkan. Hanya http: dan https: yang diperbolehkan.`,
      };
    }

    const hostname = url.hostname.toLowerCase().trim();

    // 2. Reject empty hostname
    if (!hostname) {
      return { safe: false, reason: 'Hostname kosong.' };
    }

    // 3. Reject known cloud metadata hostnames directly
    if (METADATA_HOSTNAMES.has(hostname)) {
      return {
        safe: false,
        reason: 'Akses ke cloud metadata service atau internal endpoint dilarang.',
      };
    }

    // 4. Reject localhost aliases
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname === 'localtest.me' ||
      hostname.endsWith('.localtest.me')
    ) {
      if (!this.allowPrivateForTesting) {
        return {
          safe: false,
          reason: 'Akses ke localhost atau loopback alias dilarang demi keamanan.',
        };
      }
    }

    // 5. Domain deny list check
    for (const denied of this.deniedDomains) {
      if (hostname === denied || hostname.endsWith(`.${denied}`)) {
        return {
          safe: false,
          reason: `Domain '${hostname}' terdaftar dalam daftar blokir (domain deny list).`,
        };
      }
    }

    // 6. Domain allow list check (if configured)
    if (this.allowedDomains.size > 0) {
      let isAllowed = false;
      for (const allowed of this.allowedDomains) {
        if (hostname === allowed || hostname.endsWith(`.${allowed}`)) {
          isAllowed = true;
          break;
        }
      }
      if (!isAllowed) {
        return {
          safe: false,
          reason: `Domain '${hostname}' tidak terdaftar dalam domain allow list.`,
        };
      }
    }

    // If testing flag is active, skip IP inspection
    if (this.allowPrivateForTesting) {
      return { safe: true };
    }

    // 7. Check if hostname is an IP literal
    const ipType = isIP(hostname.replace(/^\[|\]$/g, ''));
    if (ipType === 4 || parseIPv4ToNumber(hostname) !== null) {
      const ipv4Num = parseIPv4ToNumber(hostname);
      if (ipv4Num !== null && isPrivateIPv4(ipv4Num)) {
        return {
          safe: false,
          reason: `Akses ke alamat IP privat/internal (${hostname}) dilarang keras (SSRF protection).`,
        };
      }
    } else if (ipType === 6 || hostname.startsWith('[')) {
      if (isPrivateIPv6(hostname)) {
        return {
          safe: false,
          reason: `Akses ke alamat IPv6 privat/loopback (${hostname}) dilarang keras (SSRF protection).`,
        };
      }
    }

    // 8. DNS Resolution Check to prevent DNS rebinding attacks
    if (this.resolveDns && ipType === 0) {
      try {
        let records: Array<{ address: string; family: number }> = [];
        if (this.dnsResolver) {
          const raw = await this.dnsResolver(hostname);
          records = raw.map((r) => {
            if (typeof r === 'string') {
              const detected = isIP(r);
              return { address: r, family: detected === 6 ? 6 : 4 };
            }
            const detected = r.family ?? (isIP(r.address) === 6 ? 6 : 4);
            return { address: r.address, family: detected };
          });
        } else {
          const lookupResult = await lookup(hostname, { all: true });
          records = lookupResult.map((r) => ({ address: r.address, family: r.family }));
        }

        for (const record of records) {
          if (record.family === 4) {
            const num = parseIPv4ToNumber(record.address);
            if (num !== null && isPrivateIPv4(num)) {
              return {
                safe: false,
                reason: `Hostname '${hostname}' menyelesaikan ke IP internal (${record.address}). Terdeteksi potensi DNS rebinding / SSRF.`,
              };
            }
          } else if (record.family === 6) {
            if (isPrivateIPv6(record.address)) {
              return {
                safe: false,
                reason: `Hostname '${hostname}' menyelesaikan ke IPv6 internal (${record.address}). Terdeteksi potensi SSRF.`,
              };
            }
          }
        }
      } catch {
        // DNS lookup failed: let external request fail naturally or reject
        return { safe: false, reason: `Gagal menyelesaikan DNS untuk host '${hostname}'.` };
      }
    }

    return { safe: true };
  }

  /**
   * Asserts that a URL is safe; throws SsrfViolationError if not.
   */
  async assertSafeUrl(urlString: string): Promise<void> {
    const result = await this.validateUrl(urlString);
    if (!result.safe) {
      throw new SsrfViolationError(urlString, result.reason ?? 'Akses dilarang.');
    }
  }
}

export const defaultSsrfGuard = new SsrfGuard();
