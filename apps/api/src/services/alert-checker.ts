/**
 * Personal AI OS — Sistem Alerting Minimal Realistis
 * Memeriksa status kesehatan sistem (/ready), antrean, backup, disk, dan sertifikat TLS,
 * serta mengirim notifikasi ke bot Telegram yang sudah ada tanpa membuat bot baru.
 */

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertIncident {
  id: string;
  title: string;
  description: string;
  severity: AlertSeverity;
  timestamp: number;
  metadata?: Record<string, unknown> | undefined;
}

export interface AlertTransport {
  sendAlert(incident: AlertIncident): Promise<boolean>;
}

export class TelegramAlertTransport implements AlertTransport {
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: {
    botToken: string;
    chatId: string;
    fetchFn?: typeof fetch | undefined;
  }) {
    this.botToken = options.botToken;
    this.chatId = options.chatId;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  formatMessage(incident: AlertIncident): string {
    const icon = incident.severity === 'critical' ? '🚨' : '⚠️';
    const dateStr = new Date(incident.timestamp).toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      dateStyle: 'medium',
      timeStyle: 'medium',
    });

    let message = `${icon} *[Personal AI OS Alert — ${incident.severity.toUpperCase()}]*\n\n` +
      `*Masalah:* ${incident.title}\n` +
      `*Waktu:* ${dateStr} WIB\n` +
      `*Detail:* ${incident.description}\n`;

    if (incident.metadata && Object.keys(incident.metadata).length > 0) {
      message += '\n*Informasi Teknis:*\n';
      for (const [key, val] of Object.entries(incident.metadata)) {
        message += `• \`${key}\`: ${String(val)}\n`;
      }
    }

    message += '\n_Silakan periksa server atau dashboard operasional._';
    return message;
  }

  async sendAlert(incident: AlertIncident): Promise<boolean> {
    const text = this.formatMessage(incident);
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'Markdown',
        }),
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}

export class MockAlertTransport implements AlertTransport {
  public sentAlerts: AlertIncident[] = [];

  async sendAlert(incident: AlertIncident): Promise<boolean> {
    this.sentAlerts.push(incident);
    return true;
  }

  clear(): void {
    this.sentAlerts = [];
  }
}

export interface AlertCheckerConfig {
  cooldownMs?: number | undefined;
  diskThresholdPercent?: number | undefined;
  tlsWarningDays?: number | undefined;
  backupMaxAgeMs?: number | undefined;
  queueStuckThreshold?: number | undefined;
}

export class VpsAlertChecker {
  private readonly transport: AlertTransport;
  private readonly cooldownMs: number;
  private readonly diskThresholdPercent: number;
  private readonly tlsWarningDays: number;
  private readonly backupMaxAgeMs: number;
  private readonly queueStuckThreshold: number;
  private readonly lastDispatched = new Map<string, number>();

  constructor(transport: AlertTransport, config?: AlertCheckerConfig) {
    this.transport = transport;
    this.cooldownMs = config?.cooldownMs ?? 30 * 60 * 1000; // 30 minutes cooldown
    this.diskThresholdPercent = config?.diskThresholdPercent ?? 85;
    this.tlsWarningDays = config?.tlsWarningDays ?? 14;
    this.backupMaxAgeMs = config?.backupMaxAgeMs ?? 26 * 3600 * 1000; // 26 hours
    this.queueStuckThreshold = config?.queueStuckThreshold ?? 25;
  }

  private shouldDispatch(incidentId: string, now: number): boolean {
    const last = this.lastDispatched.get(incidentId);
    if (!last || now - last >= this.cooldownMs) {
      this.lastDispatched.set(incidentId, now);
      return true;
    }
    return false;
  }

  async checkReadyEndpoint(
    statusCheck: () => Promise<{ ok: boolean; status: number; body?: unknown }>,
    now = Date.now(),
  ): Promise<AlertIncident | null> {
    try {
      const res = await statusCheck();
      if (!res.ok) {
        const incident: AlertIncident = {
          id: 'ready_endpoint_down',
          title: 'Layanan API tidak siap (/ready gagal)',
          description: `Endpoint /ready mengembalikan status HTTP ${res.status}. Database atau Redis kemungkinan terputus.`,
          severity: 'critical',
          timestamp: now,
          metadata: { httpStatus: res.status, details: JSON.stringify(res.body ?? {}) },
        };
        if (this.shouldDispatch(incident.id, now)) {
          await this.transport.sendAlert(incident);
        }
        return incident;
      }
    } catch (err: unknown) {
      const incident: AlertIncident = {
        id: 'ready_endpoint_down',
        title: 'Layanan API tidak dapat dihubungi (/ready error)',
        description: `Koneksi ke endpoint /ready gagal: ${err instanceof Error ? err.message : String(err)}`,
        severity: 'critical',
        timestamp: now,
      };
      if (this.shouldDispatch(incident.id, now)) {
        await this.transport.sendAlert(incident);
      }
      return incident;
    }
    return null;
  }

  async checkQueueHealth(
    stats: { waiting: number; active: number; failed: number },
    now = Date.now(),
  ): Promise<AlertIncident | null> {
    if (stats.waiting > this.queueStuckThreshold || stats.failed > 10) {
      const incident: AlertIncident = {
        id: 'queue_stuck',
        title: 'Antrean Task BullMQ Terindikasi Macet',
        description: `Terdapat ${stats.waiting} task menunggu dan ${stats.failed} task gagal. Worker mungkin kelebihan beban atau terhenti.`,
        severity: stats.waiting > 50 ? 'critical' : 'warning',
        timestamp: now,
        metadata: { waitingJobs: stats.waiting, activeJobs: stats.active, failedJobs: stats.failed },
      };
      if (this.shouldDispatch(incident.id, now)) {
        await this.transport.sendAlert(incident);
      }
      return incident;
    }
    return null;
  }

  async checkBackupFreshness(
    lastBackupTimestamp: number,
    now = Date.now(),
  ): Promise<AlertIncident | null> {
    const ageMs = now - lastBackupTimestamp;
    if (ageMs > this.backupMaxAgeMs) {
      const ageHours = Math.round(ageMs / 3600000);
      const incident: AlertIncident = {
        id: 'backup_stale',
        title: 'Backup Database Otomatis Kedaluwarsa / Gagal',
        description: `Snapshot database terakhir dibuat ${ageHours} jam yang lalu (melebihi batas ${Math.round(this.backupMaxAgeMs / 3600000)} jam).`,
        severity: 'critical',
        timestamp: now,
        metadata: { ageHours, lastBackupTime: new Date(lastBackupTimestamp).toISOString() },
      };
      if (this.shouldDispatch(incident.id, now)) {
        await this.transport.sendAlert(incident);
      }
      return incident;
    }
    return null;
  }

  async checkDiskUsage(usedPercent: number, now = Date.now()): Promise<AlertIncident | null> {
    if (usedPercent >= this.diskThresholdPercent) {
      const incident: AlertIncident = {
        id: 'disk_nearly_full',
        title: 'Kapasitas Disk VPS Hampir Penuh',
        description: `Penggunaan disk telah mencapai ${usedPercent}% (ambang batas: ${this.diskThresholdPercent}%). Risiko kehabisan ruang disk.`,
        severity: usedPercent >= 95 ? 'critical' : 'warning',
        timestamp: now,
        metadata: { usedPercent, thresholdPercent: this.diskThresholdPercent },
      };
      if (this.shouldDispatch(incident.id, now)) {
        await this.transport.sendAlert(incident);
      }
      return incident;
    }
    return null;
  }

  async checkTlsExpiration(
    validToTimestamp: number,
    now = Date.now(),
  ): Promise<AlertIncident | null> {
    const remainingDays = Math.floor((validToTimestamp - now) / (24 * 3600 * 1000));
    if (remainingDays <= this.tlsWarningDays) {
      const incident: AlertIncident = {
        id: 'tls_expiring',
        title: 'Sertifikat SSL/TLS Mendekati Masa Kedaluwarsa',
        description: `Sertifikat TLS domain akan kedaluwarsa dalam ${remainingDays} hari. Periksa pembaruan otomatis ACME Caddy/Nginx.`,
        severity: remainingDays <= 3 ? 'critical' : 'warning',
        timestamp: now,
        metadata: { remainingDays, expirationDate: new Date(validToTimestamp).toISOString() },
      };
      if (this.shouldDispatch(incident.id, now)) {
        await this.transport.sendAlert(incident);
      }
      return incident;
    }
    return null;
  }
}
