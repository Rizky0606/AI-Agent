export type BrowserActionType =
  | 'navigate'
  | 'click'
  | 'type'
  | 'submit'
  | 'screenshot'
  | 'extract_content'
  | 'login'
  | 'download';

export interface BrowserSessionOptions {
  sessionId: string;
  actorId: string;
  projectId?: string | null | undefined;
  taskId?: string | null | undefined;
  allowedDomains?: string[] | undefined;
  deniedDomains?: string[] | undefined;
  maxSteps?: number | undefined;
  timeoutMs?: number | undefined;
}

export interface BrowserStepRecord {
  stepNumber: number;
  action: BrowserActionType;
  target?: string | undefined;
  durationMs: number;
  timestamp: string;
  error?: string | undefined;
}

export interface BrowserActionResult {
  success: boolean;
  action: BrowserActionType;
  currentUrl: string;
  title?: string | undefined;
  content?: string | undefined;
  screenshotArtifactId?: string | undefined;
  stepNumber: number;
  remainingSteps: number;
}

export class BrowserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserError';
  }
}

export class BrowserStepLimitExceededError extends BrowserError {
  readonly maxSteps: number;

  constructor(maxSteps: number) {
    super(
      `Batas langkah browser (${maxSteps} langkah) telah tercapai. Eksekusi lebih lanjut diblokir demi keamanan.`,
    );
    this.name = 'BrowserStepLimitExceededError';
    this.maxSteps = maxSteps;
  }
}

export class BrowserDomainBlockedError extends BrowserError {
  readonly domain: string;

  constructor(domain: string, reason: string) {
    super(`Navigasi browser ke domain '${domain}' diblokir: ${reason}`);
    this.name = 'BrowserDomainBlockedError';
    this.domain = domain;
  }
}

export class BrowserSensitiveActionRequiresApprovalError extends BrowserError {
  readonly action: BrowserActionType;

  constructor(action: BrowserActionType) {
    super(
      `Aksi browser sensitif '${action}' memerlukan persetujuan eksplisit (approval) dari pengguna.`,
    );
    this.name = 'BrowserSensitiveActionRequiresApprovalError';
    this.action = action;
  }
}

export class BrowserConcurrencyLimitError extends BrowserError {
  constructor(limit: number) {
    super(
      `Batas konkurensi browser (${limit} sesi simultan) tercapai. Harap tunggu hingga sesi sebelumnya selesai.`,
    );
    this.name = 'BrowserConcurrencyLimitError';
  }
}
