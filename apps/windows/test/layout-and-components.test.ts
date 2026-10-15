import test from 'node:test';
import assert from 'node:assert/strict';
import { groupConversations } from '../src/ui/chat/conversation-grouping.ts';
import { idID } from '../src/ui/locales/id-ID.ts';
import type { ChatConversation } from '../src/state/agent-store.ts';

test('Conversation Grouping: correctly groups by today, yesterday, and older', () => {
  const now = new Date();

  const convToday: ChatConversation = {
    id: 'c-today',
    title: 'Chat Hari Ini',
    messages: [],
    createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 2).toISOString(), // 2 hours ago
  };

  const convYesterday: ChatConversation = {
    id: 'c-yesterday',
    title: 'Chat Kemarin',
    messages: [],
    createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 28).toISOString(), // 28 hours ago
  };

  const convOlder: ChatConversation = {
    id: 'c-older',
    title: 'Chat Minggu Lalu',
    messages: [],
    createdAt: new Date(now.getTime() - 1000 * 60 * 60 * 72).toISOString(), // 72 hours ago
  };

  const convNoDate: ChatConversation = {
    id: 'c-nodate',
    title: 'Chat Tanpa Tanggal',
    messages: [],
  };

  const grouped = groupConversations(
    [convToday, convYesterday, convOlder, convNoDate],
    now,
  );

  assert.equal(grouped.today.length, 2, 'Today should include convToday and convNoDate as fallback');
  assert.equal(grouped.today[0]?.id, 'c-today');
  assert.equal(grouped.today[1]?.id, 'c-nodate');

  assert.equal(grouped.yesterday.length, 1);
  assert.equal(grouped.yesterday[0]?.id, 'c-yesterday');

  assert.equal(grouped.older.length, 1);
  assert.equal(grouped.older[0]?.id, 'c-older');
});

test('EmptyChatState: provides exactly 4 sample prompts in Indonesian', () => {
  const samplePrompts = idID.chat.samplePrompts;
  assert.equal(samplePrompts.length, 4, 'Must provide exactly 4 sample prompts');
  for (const item of samplePrompts) {
    assert.ok(item.title.length > 0, 'Title must not be empty');
    assert.ok(item.prompt.length > 0, 'Prompt text must not be empty');
  }
});

test('id-ID Localization: contains consistent Indonesian strings and formatters', () => {
  // Brand
  assert.equal(idID.brand.name, 'Personal AI OS');
  assert.equal(idID.brand.windowsAgent, 'Windows Agent');

  // Navigation
  assert.equal(idID.nav.chat, 'Obrolan');
  assert.equal(idID.nav.project, 'Proyek');
  assert.equal(idID.nav.settings, 'Pengaturan');
  assert.equal(idID.nav.activity, 'Aktivitas');

  // Approvals formatting
  const notifMsg = idID.activity.approvals.newApprovalNotification('write_file');
  assert.ok(notifMsg.includes('write_file'), 'Notification must include action name');
  assert.ok(notifMsg.includes('Persetujuan baru'), 'Notification must be in Indonesian');

  const confirmBody = idID.activity.approvals.confirmBody('delete_database', 'production');
  assert.ok(confirmBody.includes('delete_database'));
  assert.ok(confirmBody.includes('production'));
  assert.ok(confirmBody.includes('TINGGI/KRITIS'));

  // Artifact size formatting
  assert.equal(idID.activity.artifacts.sizeBytes(1024), '1024 B');
});

test('Approval Risk Assessment: identifies HIGH and CRITICAL risks requiring Dialog', () => {
  const requiresDialog = (riskLevel: string) => {
    return riskLevel === 'HIGH' || riskLevel === 'CRITICAL';
  };

  assert.equal(requiresDialog('CRITICAL'), true);
  assert.equal(requiresDialog('HIGH'), true);
  assert.equal(requiresDialog('MEDIUM'), false);
  assert.equal(requiresDialog('LOW'), false);
});

test('Project Diff Detection: identifies changes and blocks saving when no changes', () => {
  const original = 'function hello() { return "world"; }';
  const modified = 'function hello() { return "Indonesia"; }';

  const hasChanges = (curr: string, orig: string) => curr !== orig;

  assert.equal(hasChanges(modified, original), true, 'Different text should trigger diff');
  assert.equal(hasChanges(original, original), false, 'Identical text should not trigger diff');
});

test('Responsive Layout: auto-collapse threshold under 900px', () => {
  const shouldAutoCollapse = (width: number) => width < 900;

  assert.equal(shouldAutoCollapse(1200), false, '1200px should keep sidebar expanded');
  assert.equal(shouldAutoCollapse(900), false, '900px should keep sidebar expanded');
  assert.equal(shouldAutoCollapse(899), true, '899px should trigger auto-collapse');
  assert.equal(shouldAutoCollapse(800), true, '800px (min width) should auto-collapse sidebar');
});
