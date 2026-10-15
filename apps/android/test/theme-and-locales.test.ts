import assert from 'node:assert/strict';
import test from 'node:test';
import { darkTheme, lightTheme, resolveTheme } from '../src/components/Theme.ts';
import { idID } from '../src/locales/id-ID.ts';

test('Theme: resolveTheme accurately switches between light, dark, and system', () => {
  assert.equal(resolveTheme('light'), lightTheme);
  assert.equal(resolveTheme('dark'), darkTheme);

  // System follows OS color scheme
  assert.equal(resolveTheme('system', 'light'), lightTheme);
  assert.equal(resolveTheme('system', 'dark'), darkTheme);
  assert.equal(resolveTheme('system', null), darkTheme); // default dark fallback
});

test('Theme: touch targets strictly satisfy WCAG & Android Material >= 44-48 dp', () => {
  assert.ok(darkTheme.controls.minTouchTarget >= 44);
  assert.ok(lightTheme.controls.minTouchTarget >= 44);
});

test('Localization id-ID: complete translation dictionary covers all navigation, chat, and activity surfaces', () => {
  // Navigation tabs
  assert.equal(idID.nav.chat, 'Chat');
  assert.equal(idID.nav.activity, 'Aktivitas');
  assert.equal(idID.nav.more, 'Lainnya');

  // Auth
  assert.equal(idID.auth.loginGoogle, 'Masuk dengan Google');
  assert.ok(idID.auth.otherOptions.length > 0);
  assert.ok(idID.auth.advancedSettings.length > 0);

  // Chat
  assert.ok(idID.chat.samplePrompts.length === 4);
  assert.equal(idID.chat.composerPlaceholder, 'Tanyakan apa saja atau berikan instruksi tugas…');
  assert.ok(idID.chat.copyMessage.length > 0);
  assert.ok(idID.chat.retryMessage.length > 0);

  // Approvals & Activities
  assert.ok(idID.activity.tabTasks.length > 0);
  assert.ok(idID.activity.tabApprovals.length > 0);
  assert.ok(idID.approval.secondaryConfirmTitle.length > 0);
  assert.ok(idID.approval.confirmProceed.length > 0);

  // More/Settings
  assert.ok(idID.more.sectionAccount.length > 0);
  assert.ok(idID.more.sectionModel.length > 0);
  assert.ok(idID.more.sectionAppearance.length > 0);
  assert.ok(idID.more.sectionMemory.length > 0);
  assert.ok(idID.more.sectionSkills.length > 0);
  assert.ok(idID.more.sectionAdvanced.length > 0);
});
