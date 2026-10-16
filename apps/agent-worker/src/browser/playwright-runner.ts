import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { BrowserRunner, BrowserRunnerContext } from '@personal-ai-os/tools';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_CONTENT_CHARS = 64_000;

/** Container-friendly flags: no sandbox, no GPU, and no reliance on a large /dev/shm. */
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
];

async function readPage(page: Page): Promise<{ url: string; title: string; content: string }> {
  const url = page.url();
  const title = await page.title();
  const content = await page.evaluate(() => document.body?.innerText ?? '');
  return { url, title, content: content.slice(0, MAX_CONTENT_CHARS) };
}

/** Real Chromium runner. Lives in the worker so the API image never carries Playwright. */
export class PlaywrightRunner implements BrowserRunner {
  private browser: Browser | undefined;
  private readonly contexts = new Set<BrowserContext>();

  async createContext(options?: { userAgent?: string | undefined }): Promise<BrowserRunnerContext> {
    this.browser ??= await chromium.launch({ args: LAUNCH_ARGS });

    const context = await this.browser.newContext({
      ...(options?.userAgent ? { userAgent: options.userAgent } : {}),
      viewport: { width: 1280, height: 800 },
    });
    this.contexts.add(context);

    const page = await context.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT_MS);

    return {
      navigate: async (url, navOptions) => {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: navOptions?.timeout ?? DEFAULT_TIMEOUT_MS,
        });
        return readPage(page);
      },
      click: async (selector) => {
        await page.click(selector);
      },
      type: async (selector, text) => {
        await page.fill(selector, text);
      },
      submit: async (selector) => {
        await Promise.all([
          page
            .waitForLoadState('domcontentloaded', { timeout: DEFAULT_TIMEOUT_MS })
            .catch(() => undefined),
          page.press(selector, 'Enter'),
        ]);
        return readPage(page);
      },
      screenshot: async () => page.screenshot({ type: 'png' }),
      extractContent: async () => readPage(page),
      close: async () => {
        this.contexts.delete(context);
        await context.close().catch(() => undefined);
      },
    };
  }

  async close(): Promise<void> {
    for (const context of this.contexts) await context.close().catch(() => undefined);
    this.contexts.clear();
    await this.browser?.close().catch(() => undefined);
    this.browser = undefined;
  }
}
