import assert from 'node:assert/strict';
import test from 'node:test';
import { AutoUpdaterService } from '../src/updater/updater-service.ts';

test('AutoUpdaterService: gracefully handles headless/offline conditions without crashing', async () => {
  const service = new AutoUpdaterService();

  assert.equal(service.isUpdatePending(), false);

  const result = await service.checkForUpdates();
  assert.equal(result.available, false);
});
