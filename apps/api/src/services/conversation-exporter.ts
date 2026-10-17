import type { ConversationRecord, MessageRecord } from '../db/chat-repository.ts';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeExportText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, '[REDACTED_TOKEN]')
    .replace(/sk-[a-zA-Z0-9_-]{20,}/gi, '[REDACTED_API_KEY]')
    .replace(/ghp_[a-zA-Z0-9]{20,}/gi, '[REDACTED_GITHUB_TOKEN]')
    .replace(/personal_ai_[a-zA-Z0-9_]+/gi, '[REDACTED_CREDENTIAL]');
}

export function exportConversationToMarkdown(
  conversation: ConversationRecord,
  messages: MessageRecord[],
): string {
  const title = conversation.title?.trim() || 'Percakapan Tanpa Judul';
  let md = `# ${title}\n\n`;
  md += `> **ID Sesi**: \`${conversation.id}\`  \n`;
  md += `> **Dibuat**: ${conversation.createdAt.toISOString()}  \n`;
  md += `> **Mode**: \`${conversation.mode}\`  \n`;
  if (conversation.model) {
    md += `> **Model**: \`${conversation.model}\`  \n`;
  }
  if (conversation.compactedSummary) {
    md += `> **Ringkasan Konteks**: ${conversation.compactedSummary.replace(/\n/g, ' ')}  \n`;
  }
  md += `\n---\n\n`;

  for (const msg of messages) {
    const roleLabel =
      msg.role === 'user' ? '👤 Pengguna' : msg.role === 'assistant' ? '🤖 Asisten' : `⚙️ ${msg.role.toUpperCase()}`;
    const timestamp = msg.createdAt.toISOString();
    const branchInfo =
      (msg.branchCount ?? 1) > 1 ? ` *(Cabang ${(msg.branchIndex ?? 0) + 1}/${msg.branchCount})*` : '';

    md += `### ${roleLabel}${branchInfo} — *${timestamp}*\n\n`;
    md += `${sanitizeExportText(msg.content)}\n\n`;
    md += `---\n\n`;
  }

  md += `\n*Diekspor dari Personal AI OS pada ${new Date().toISOString()}*\n`;
  return md;
}

export function exportConversationToHtml(
  conversation: ConversationRecord,
  messages: MessageRecord[],
): string {
  const title = conversation.title?.trim() || 'Percakapan Tanpa Judul';
  const safeTitle = escapeHtml(title);

  const messagesHtml = messages
    .map((msg) => {
      const isUser = msg.role === 'user';
      const roleLabel = isUser ? 'Pengguna' : msg.role === 'assistant' ? 'Asisten AI' : msg.role.toUpperCase();
      const roleClass = isUser ? 'user' : 'assistant';
      const branchLabel =
        (msg.branchCount ?? 1) > 1
          ? `<span class="branch-pill">Cabang ${(msg.branchIndex ?? 0) + 1}/${msg.branchCount}</span>`
          : '';

      const sanitized = escapeHtml(sanitizeExportText(msg.content));

      return `
    <article class="message ${roleClass}">
      <div class="message-meta">
        <span class="role-badge">${roleLabel}</span>
        ${branchLabel}
        <time class="time-stamp">${escapeHtml(msg.createdAt.toISOString())}</time>
      </div>
      <div class="message-content">${sanitized}</div>
    </article>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle} — Personal AI OS</title>
  <style>
    :root {
      --bg: #0F1115;
      --surface: #171A21;
      --surface-user: #1C222D;
      --border: rgba(255, 255, 255, 0.08);
      --border-accent: rgba(45, 212, 191, 0.3);
      --text-main: #ECEEF2;
      --text-muted: #9AA1AE;
      --accent: #2DD4BF;
      --accent-subtle: rgba(45, 212, 191, 0.12);
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #FAFAF8;
        --surface: #FFFFFF;
        --surface-user: #F1F4F9;
        --border: rgba(0, 0, 0, 0.08);
        --border-accent: rgba(13, 148, 136, 0.3);
        --text-main: #15171C;
        --text-muted: #5B6270;
        --accent: #0D9488;
        --accent-subtle: rgba(13, 148, 136, 0.12);
      }
    }
    body {
      margin: 0;
      padding: 32px 16px;
      background-color: var(--bg);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
    }
    .export-container {
      max-width: 820px;
      margin: 0 auto;
    }
    .export-header {
      padding-bottom: 24px;
      margin-bottom: 32px;
      border-bottom: 1px solid var(--border);
    }
    .export-title {
      margin: 0 0 10px 0;
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--text-main);
    }
    .export-meta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .export-meta-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .compacted-summary-box {
      margin-top: 16px;
      padding: 12px 16px;
      border-radius: 8px;
      background-color: var(--surface);
      border-left: 3px solid var(--accent);
      font-size: 0.88rem;
    }
    .messages-list {
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .message {
      padding: 18px 20px;
      border-radius: 12px;
      border: 1px solid var(--border);
    }
    .message.user {
      background-color: var(--surface-user);
      border-color: var(--border-accent);
    }
    .message.assistant {
      background-color: var(--surface);
    }
    .message-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 0.8rem;
    }
    .role-badge {
      font-weight: 600;
      color: var(--accent);
    }
    .branch-pill {
      background-color: var(--accent-subtle);
      color: var(--accent);
      font-size: 0.72rem;
      padding: 1px 7px;
      border-radius: 10px;
      font-weight: 500;
    }
    .time-stamp {
      color: var(--text-muted);
      margin-left: auto;
      font-size: 0.75rem;
    }
    .message-content {
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.95rem;
    }
    .export-footer {
      margin-top: 48px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      text-align: center;
      font-size: 0.78rem;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="export-container">
    <header class="export-header">
      <h1 class="export-title">${safeTitle}</h1>
      <div class="export-meta-row">
        <span class="export-meta-item"><strong>ID Sesi:</strong> ${escapeHtml(conversation.id)}</span>
        <span class="export-meta-item"><strong>Mode:</strong> ${escapeHtml(conversation.mode)}</span>
        ${conversation.model ? `<span class="export-meta-item"><strong>Model:</strong> ${escapeHtml(conversation.model)}</span>` : ''}
        <span class="export-meta-item"><strong>Waktu:</strong> ${escapeHtml(conversation.createdAt.toISOString())}</span>
      </div>
      ${conversation.compactedSummary ? `
      <div class="compacted-summary-box">
        <strong>Ringkasan Konteks Terdahulu:</strong>
        <div>${escapeHtml(conversation.compactedSummary)}</div>
      </div>` : ''}
    </header>

    <main class="messages-list">
${messagesHtml}
    </main>

    <footer class="export-footer">
      <span>Personal AI OS — Ekspor Dokumen Mandiri (Offline Safe)</span>
    </footer>
  </div>
</body>
</html>`;
}
