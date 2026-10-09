export interface BrowserRunnerContext {
  navigate(
    url: string,
    options?: { timeout?: number | undefined },
  ): Promise<{ url: string; title: string; content: string }>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  submit(selector: string): Promise<{ url: string; title: string; content: string }>;
  screenshot(): Promise<Buffer>;
  extractContent(): Promise<{ title: string; content: string; url: string }>;
  close(): Promise<void>;
}

export interface BrowserRunner {
  createContext(options?: { userAgent?: string | undefined }): Promise<BrowserRunnerContext>;
  close(): Promise<void>;
}

// 1x1 transparent PNG buffer header for mock screenshots
const MOCK_PNG_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

export class MockPlaywrightContext implements BrowserRunnerContext {
  private currentUrl = 'about:blank';
  private currentTitle = 'Blank Page';
  private currentContent = '';
  private isClosed = false;

  async navigate(url: string): Promise<{ url: string; title: string; content: string }> {
    if (this.isClosed) throw new Error('Browser context telah ditutup.');
    this.currentUrl = url;
    this.currentTitle = `Page: ${new URL(url).hostname}`;
    this.currentContent = `Simulated page content for ${url} (Rendered cleanly)`;
    return {
      url: this.currentUrl,
      title: this.currentTitle,
      content: this.currentContent,
    };
  }

  async click(selector: string): Promise<void> {
    if (this.isClosed) throw new Error('Browser context telah ditutup.');
    this.currentContent += `\n[Clicked on selector: ${selector}]`;
  }

  async type(selector: string, text: string): Promise<void> {
    if (this.isClosed) throw new Error('Browser context telah ditutup.');
    this.currentContent += `\n[Typed '${text}' into ${selector}]`;
  }

  async submit(selector: string): Promise<{ url: string; title: string; content: string }> {
    if (this.isClosed) throw new Error('Browser context telah ditutup.');
    this.currentTitle = `Submitted: ${this.currentTitle}`;
    this.currentContent += `\n[Form submitted via ${selector}]`;
    return {
      url: this.currentUrl,
      title: this.currentTitle,
      content: this.currentContent,
    };
  }

  async screenshot(): Promise<Buffer> {
    if (this.isClosed) throw new Error('Browser context telah ditutup.');
    return Buffer.from(MOCK_PNG_BUFFER);
  }

  async extractContent(): Promise<{ title: string; content: string; url: string }> {
    if (this.isClosed) throw new Error('Browser context telah ditutup.');
    return {
      title: this.currentTitle,
      content: this.currentContent,
      url: this.currentUrl,
    };
  }

  async close(): Promise<void> {
    this.isClosed = true;
  }
}

export class MockPlaywrightRunner implements BrowserRunner {
  private isRunning = true;

  async createContext(): Promise<BrowserRunnerContext> {
    if (!this.isRunning) throw new Error('Playwright browser runner telah ditutup.');
    return new MockPlaywrightContext();
  }

  async close(): Promise<void> {
    this.isRunning = false;
  }
}
