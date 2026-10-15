export interface EgressValidationResult {
  allowed: boolean;
  normalizedUrl: string;
  reason?: string | undefined;
}

const PRIVATE_IP_REGEXES = [
  /^127\./, // 127.0.0.0/8 (Loopback)
  /^10\./, // 10.0.0.0/8 (Private)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12 (Private)
  /^192\.168\./, // 192.168.0.0/16 (Private)
  /^169\.254\./, // 169.254.0.0/16 (Link-Local & Cloud Metadata)
  /^0\./, // 0.0.0.0/8
];

const FORBIDDEN_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  '169.254.169.254',
  'instance-data',
  '::1',
  '[::1]',
]);

/**
 * Validates remote MCP URLs against egress policies and SSRF threats.
 */
export function validateRemoteMcpUrl(
  rawUrl: string,
  options?: {
    allowedHosts?: string[] | undefined;
    allowPrivateInDev?: boolean | undefined;
  },
): EgressValidationResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    return {
      allowed: false,
      normalizedUrl: rawUrl,
      reason: `URL tidak valid: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 1. Enforce HTTP/HTTPS protocol only
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      allowed: false,
      normalizedUrl: parsed.toString(),
      reason: `Protokol '${parsed.protocol}' ditolak. Hanya http: dan https: yang diizinkan.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // 2. Check explicit host allowlist
  const explicitAllowlist = options?.allowedHosts ?? [];
  if (explicitAllowlist.length > 0) {
    const isExplicitlyAllowed = explicitAllowlist.some(
      (allowed) => allowed.toLowerCase() === hostname,
    );
    if (!isExplicitlyAllowed) {
      return {
        allowed: false,
        normalizedUrl: parsed.toString(),
        reason: `Host '${hostname}' tidak terdaftar dalam allowlist host remote (${explicitAllowlist.join(', ')}).`,
      };
    }
    return {
      allowed: true,
      normalizedUrl: parsed.toString(),
    };
  }

  // 3. Block loopback and metadata hostnames
  if (FORBIDDEN_HOSTNAMES.has(hostname) || /^127\./.test(hostname)) {
    return {
      allowed: false,
      normalizedUrl: parsed.toString(),
      reason: `Akses ke host lokal/metadata cloud '${hostname}' diblokir demi pencegahan SSRF.`,
    };
  }

  // 4. Block private IPv4 ranges
  const isPrivateIp = PRIVATE_IP_REGEXES.some((regex) => regex.test(hostname));
  if (isPrivateIp) {
    if (options?.allowPrivateInDev && process.env.NODE_ENV !== 'production') {
      return {
        allowed: true,
        normalizedUrl: parsed.toString(),
      };
    }
    return {
      allowed: false,
      normalizedUrl: parsed.toString(),
      reason: `Akses ke rentang IP privat/intranet '${hostname}' diblokir demi keamanan.`,
    };
  }

  return {
    allowed: true,
    normalizedUrl: parsed.toString(),
  };
}
