import { check } from '@tauri-apps/plugin-updater';

export interface UpdateInfo {
  available: boolean;
  version?: string | undefined;
  body?: string | undefined;
  date?: string | undefined;
}

export class AutoUpdaterService {
  private updatePending = false;

  async checkForUpdates(): Promise<UpdateInfo> {
    try {
      const update = await check();
      if (update && update.available) {
        this.updatePending = true;
        return {
          available: true,
          version: update.version,
          body: update.body ?? undefined,
          date: update.date ?? undefined,
        };
      }
      return { available: false };
    } catch {
      // Offline, headless test, or Tauri updater plugin unavailable
      return { available: false };
    }
  }

  async downloadAndInstall(onProgress?: (progress: number) => void): Promise<boolean> {
    try {
      const update = await check();
      if (!update || !update.available) {
        return false;
      }

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (contentLength > 0 && onProgress) {
              onProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case 'Finished':
            if (onProgress) onProgress(100);
            break;
        }
      });

      return true;
    } catch {
      return false;
    }
  }

  isUpdatePending(): boolean {
    return this.updatePending;
  }
}

export const autoUpdater = new AutoUpdaterService();
