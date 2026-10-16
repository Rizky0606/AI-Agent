import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMarkdown,
  parseInlineTokens,
  sanitizeUrl,
} from '../src/ui/components/markdown-parser.ts';
import {
  resolveTheme,
} from '../src/ui/components/theme-manager.ts';

test('URL Sanitization: allows valid http and https links', () => {
  const httpsResult = sanitizeUrl('https://example.com/path?foo=bar#hash');
  assert.equal(httpsResult.isSafe, true);
  assert.equal(httpsResult.href, 'https://example.com/path?foo=bar#hash');

  const httpResult = sanitizeUrl('http://127.0.0.1:8080/api');
  assert.equal(httpResult.isSafe, true);
  assert.equal(httpResult.href, 'http://127.0.0.1:8080/api');
});

test('URL Sanitization: strictly blocks javascript: and dangerous schemes', () => {
  const jsAttacks = [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(document.cookie)',
    'javascript:/*--></title></style></textarea><em><script>alert(1)</script>',
    'java\u0000script:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'file:///C:/Windows/System32/calc.exe',
    'powershell:Start-Process calc',
  ];

  for (const attack of jsAttacks) {
    const result = sanitizeUrl(attack);
    assert.equal(
      result.isSafe,
      false,
      `Expected attack '${attack}' to be flagged as unsafe`,
    );
    assert.equal(result.href, '#blocked');
  }
});

test('Markdown Parser: parses headings, bold, italic, and code blocks', () => {
  const markdown = [
    '# Judul Utama',
    '',
    'Ini adalah teks **tebal** dan *miring* serta `kode inline`.',
    '',
    '```typescript',
    'const x = 42;',
    'console.log(x);',
    '```',
  ].join('\n');

  const blocks = parseMarkdown(markdown);
  assert.equal(blocks.length, 3);

  // Heading
  const heading = blocks[0];
  assert.ok(heading && heading.type === 'heading');
  assert.equal(heading.level, 1);
  const firstInline = heading.inlines[0];
  assert.ok(firstInline && firstInline.type === 'text');
  assert.equal(firstInline.text, 'Judul Utama');

  // Paragraph with inline elements
  const paragraph = blocks[1];
  assert.ok(paragraph && paragraph.type === 'paragraph');
  const types = paragraph.inlines.map((t: { type: string }) => t.type);
  assert.ok(types.includes('bold'));
  assert.ok(types.includes('italic'));
  assert.ok(types.includes('inline-code'));

  // Code block
  const codeblock = blocks[2];
  assert.ok(codeblock && codeblock.type === 'codeblock');
  assert.equal(codeblock.language, 'typescript');
  assert.ok(codeblock.content.includes('const x = 42;'));
});

test('Markdown Parser: parses tables and lists', () => {
  const markdown = [
    '| Kolom 1 | Kolom 2 |',
    '| --- | --- |',
    '| Data A | Data B |',
    '',
    '- Butir 1',
    '- Butir 2',
  ].join('\n');

  const blocks = parseMarkdown(markdown);
  assert.equal(blocks.length, 2);

  const table = blocks[0];
  assert.ok(table && table.type === 'table');
  assert.equal(table.headers.length, 2);
  assert.equal(table.rows.length, 1);

  const list = blocks[1];
  assert.ok(list && list.type === 'list');
  assert.equal(list.ordered, false);
  assert.equal(list.items.length, 2);
});

test('Markdown Parser: treats raw HTML injection as harmless text tokens', () => {
  const xssPayloads = [
    '<script>alert("XSS")</script>',
    '<img src="x" onerror="alert(1)">',
    '<iframe src="https://evil.example.com"></iframe>',
    '<div onmouseover="alert(1)">hover me</div>',
  ];

  for (const payload of xssPayloads) {
    const blocks = parseMarkdown(payload);
    assert.equal(blocks.length, 1);
    const p = blocks[0];
    assert.ok(p && p.type === 'paragraph');
    const inline = p.inlines[0];
    assert.ok(inline && inline.type === 'text');
    assert.equal(inline.text, payload);
  }
});

test('Markdown Parser: flags dangerous markdown links as unsafe', () => {
  const markdown = 'Klik [di sini](javascript:alert(document.domain)) untuk hadiah!';
  const inlines = parseInlineTokens(markdown);

  const linkToken = inlines.find((t) => t.type === 'link');
  assert.ok(linkToken, 'Should find link token');
  if (linkToken && linkToken.type === 'link') {
    assert.equal(linkToken.isSafe, false);
    assert.equal(linkToken.href, '#blocked');
  }
});

test('Theme Manager: resolves light and dark themes correctly', () => {
  assert.equal(resolveTheme('light'), 'light');
  assert.equal(resolveTheme('dark'), 'dark');
  // system fallback when window.matchMedia is undefined in Node environment
  assert.equal(resolveTheme('system'), 'dark');
});
