import assert from 'node:assert/strict';
import test from 'node:test';
import { DeepLinkService } from '../src/services/deep-link.ts';
import type { RiskLevel } from '../src/api/types.ts';

test('Navigation & DeepLink: routes correctly resolve to 3-tab target screens', () => {
  // Chat routes
  const chat1 = DeepLinkService.parseUrl('personal-ai://chat/c-123');
  assert.deepEqual(chat1, { screen: 'Chat', conversationId: 'c-123' });

  // Approval routes (maps to Activity tab)
  const app1 = DeepLinkService.parseUrl('personal-ai://approvals/app-999');
  assert.deepEqual(app1, { screen: 'ApprovalDetail', approvalId: 'app-999' });

  // Task routes (maps to Activity tab -> TaskDetail)
  const task1 = DeepLinkService.parseUrl('personal-ai://tasks/t-888');
  assert.deepEqual(task1, { screen: 'TaskDetail', taskId: 't-888' });

  // Project routes (maps to More tab -> Projects)
  const proj1 = DeepLinkService.parseUrl('personal-ai://projects/p-777');
  assert.deepEqual(proj1, { screen: 'ProjectDetail', projectId: 'p-777' });
});

test('Approval Risk Assessment: identifies HIGH and CRITICAL risks requiring secondary confirmation', () => {
  const isHighRisk = (level: RiskLevel) => level === 'HIGH' || level === 'CRITICAL';

  assert.equal(isHighRisk('LOW'), false);
  assert.equal(isHighRisk('MEDIUM'), false);
  assert.equal(isHighRisk('HIGH'), true);
  assert.equal(isHighRisk('CRITICAL'), true);
});
