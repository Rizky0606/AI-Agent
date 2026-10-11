import type { ArtifactManager } from '../artifacts/artifact-manager.ts';
import { SsrfGuard, type DnsResolver } from '../ssrf/ssrf-guard.ts';
import type { BrowserRunner, BrowserRunnerContext } from './browser-runner.ts';
import {
  type BrowserActionResult,
  type BrowserSessionOptions,
  type BrowserStepRecord,
  BrowserConcurrencyLimitError,
  BrowserError,
  BrowserSensitiveActionRequiresApprovalError,
  BrowserStepLimitExceededError,
} from './types.ts';

interface ActiveBrowserSession {
  options: BrowserSessionOptions;
  context: BrowserRunnerContext;
  ssrfGuard: SsrfGuard;
  currentUrl: string;
  stepCount: number;
  maxSteps: number;
  history: BrowserStepRecord[];
  createdAt: number;
}

export class BrowserController {
  private readonly runner: BrowserRunner;
  private readonly artifactManager?: ArtifactManager | undefined;
  private readonly maxConcurrency: number;
  private readonly dnsResolver?: DnsResolver | undefined;
  private readonly sessions = new Map<string, ActiveBrowserSession>();

  constructor(options: {
    runner: BrowserRunner;
    artifactManager?: ArtifactManager | undefined;
    maxConcurrency?: number | undefined; // Default 2 for ARM64 VPS memory efficiency
    dnsResolver?: DnsResolver | undefined;
  }) {
    this.runner = options.runner;
    this.artifactManager = options.artifactManager;
    this.maxConcurrency = options.maxConcurrency ?? 2;
    this.dnsResolver = options.dnsResolver;
  }

  /**
   * Spawns an isolated, ephemeral browser session with strict concurrency check.
   */
  async createSession(options: BrowserSessionOptions): Promise<string> {
    if (this.sessions.size >= this.maxConcurrency) {
      throw new BrowserConcurrencyLimitError(this.maxConcurrency);
    }

    const ssrfGuard = new SsrfGuard({
      allowedDomains: options.allowedDomains,
      deniedDomains: options.deniedDomains,
      dnsResolver: options.dnsResolver ?? this.dnsResolver,
    });

    const context = await this.runner.createContext();
    const session: ActiveBrowserSession = {
      options,
      context,
      ssrfGuard,
      currentUrl: 'about:blank',
      stepCount: 0,
      maxSteps: options.maxSteps ?? 20,
      history: [],
      createdAt: Date.now(),
    };

    this.sessions.set(options.sessionId, session);
    return options.sessionId;
  }

  private getSession(sessionId: string): ActiveBrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BrowserError(`Sesi browser '${sessionId}' tidak ditemukan atau telah ditutup.`);
    }
    return session;
  }

  private verifyStepLimit(session: ActiveBrowserSession): void {
    if (session.stepCount >= session.maxSteps) {
      throw new BrowserStepLimitExceededError(session.maxSteps);
    }
  }

  /**
   * Navigates to a URL with strict SSRF & domain checks.
   */
  async navigate(sessionId: string, url: string): Promise<BrowserActionResult> {
    const session = this.getSession(sessionId);
    this.verifyStepLimit(session);

    // 1. SSRF and Domain Deny/Allow verification
    await session.ssrfGuard.assertSafeUrl(url);

    const startTime = Date.now();
    try {
      const navResult = await session.context.navigate(url);
      session.currentUrl = navResult.url;
      session.stepCount++;

      session.history.push({
        stepNumber: session.stepCount,
        action: 'navigate',
        target: url,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        action: 'navigate',
        currentUrl: session.currentUrl,
        title: navResult.title,
        content: navResult.content,
        stepNumber: session.stepCount,
        remainingSteps: Math.max(0, session.maxSteps - session.stepCount),
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      session.history.push({
        stepNumber: session.stepCount + 1,
        action: 'navigate',
        target: url,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        error: errorMsg,
      });
      throw err;
    }
  }

  /**
   * Takes a screenshot and saves it as an artifact via ArtifactManager.
   */
  async screenshot(sessionId: string): Promise<BrowserActionResult> {
    const session = this.getSession(sessionId);
    this.verifyStepLimit(session);

    const startTime = Date.now();
    const buffer = await session.context.screenshot();
    session.stepCount++;

    let artifactId: string | undefined;
    if (this.artifactManager) {
      const timestamp = Date.now();
      const artifact = await this.artifactManager.createArtifact({
        ownerId: session.options.actorId,
        projectId: session.options.projectId,
        taskId: session.options.taskId,
        filename: `screenshot_${timestamp}.png`,
        mimeType: 'image/png',
        content: buffer,
        retention: 'task_duration',
        metadata: {
          url: session.currentUrl,
          stepNumber: session.stepCount,
          sessionId,
        },
      });
      artifactId = artifact.id;
    }

    session.history.push({
      stepNumber: session.stepCount,
      action: 'screenshot',
      target: session.currentUrl,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      action: 'screenshot',
      currentUrl: session.currentUrl,
      screenshotArtifactId: artifactId,
      stepNumber: session.stepCount,
      remainingSteps: Math.max(0, session.maxSteps - session.stepCount),
    };
  }

  /**
   * Clicks an element by selector.
   */
  async click(sessionId: string, selector: string): Promise<BrowserActionResult> {
    const session = this.getSession(sessionId);
    this.verifyStepLimit(session);

    const startTime = Date.now();
    await session.context.click(selector);
    session.stepCount++;

    session.history.push({
      stepNumber: session.stepCount,
      action: 'click',
      target: selector,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      action: 'click',
      currentUrl: session.currentUrl,
      stepNumber: session.stepCount,
      remainingSteps: Math.max(0, session.maxSteps - session.stepCount),
    };
  }

  /**
   * Types text into an element by selector.
   */
  async type(sessionId: string, selector: string, text: string): Promise<BrowserActionResult> {
    const session = this.getSession(sessionId);
    this.verifyStepLimit(session);

    const startTime = Date.now();
    await session.context.type(selector, text);
    session.stepCount++;

    session.history.push({
      stepNumber: session.stepCount,
      action: 'type',
      target: selector,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      action: 'type',
      currentUrl: session.currentUrl,
      stepNumber: session.stepCount,
      remainingSteps: Math.max(0, session.maxSteps - session.stepCount),
    };
  }

  /**
   * Submits a form. Sensitive action: requires user approval flag.
   */
  async submit(
    sessionId: string,
    selector: string,
    isApproved: boolean,
  ): Promise<BrowserActionResult> {
    const session = this.getSession(sessionId);
    if (!isApproved) {
      throw new BrowserSensitiveActionRequiresApprovalError('submit');
    }

    this.verifyStepLimit(session);
    const startTime = Date.now();
    const submitResult = await session.context.submit(selector);
    session.currentUrl = submitResult.url;
    session.stepCount++;

    session.history.push({
      stepNumber: session.stepCount,
      action: 'submit',
      target: selector,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      action: 'submit',
      currentUrl: session.currentUrl,
      title: submitResult.title,
      content: submitResult.content,
      stepNumber: session.stepCount,
      remainingSteps: Math.max(0, session.maxSteps - session.stepCount),
    };
  }

  /**
   * Extracts text content from the current page.
   */
  async extractContent(sessionId: string): Promise<BrowserActionResult> {
    const session = this.getSession(sessionId);
    this.verifyStepLimit(session);

    const startTime = Date.now();
    const contentResult = await session.context.extractContent();
    session.stepCount++;

    session.history.push({
      stepNumber: session.stepCount,
      action: 'extract_content',
      target: session.currentUrl,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      action: 'extract_content',
      currentUrl: contentResult.url,
      title: contentResult.title,
      content: contentResult.content,
      stepNumber: session.stepCount,
      remainingSteps: Math.max(0, session.maxSteps - session.stepCount),
    };
  }

  /**
   * Closes an ephemeral session and frees concurrency slot.
   */
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.context.close().catch(() => {});
      this.sessions.delete(sessionId);
    }
  }

  getActiveSessionsCount(): number {
    return this.sessions.size;
  }
}
