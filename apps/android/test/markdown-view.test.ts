import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMarkdownBlocks } from '../src/components/markdown-parser.ts';

test('MarkdownView: parse headings of level 1, 2, and 3', () => {
  const md = '# Judul Utama\n## Sub Judul\n### Sub-sub Judul';
  const blocks = parseMarkdownBlocks(md);

  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0], { type: 'heading', level: 1, content: 'Judul Utama' });
  assert.deepEqual(blocks[1], { type: 'heading', level: 2, content: 'Sub Judul' });
  assert.deepEqual(blocks[2], { type: 'heading', level: 3, content: 'Sub-sub Judul' });
});

test('MarkdownView: parse fenced code blocks with language', () => {
  const md = 'Berikut adalah kodenya:\n```typescript\nconst greeting = "Halo Indonesia";\nconsole.log(greeting);\n```\nSelesai.';
  const blocks = parseMarkdownBlocks(md);

  assert.equal(blocks.length, 3);
  assert.equal(blocks[0]?.type, 'paragraph');
  assert.equal(blocks[0]?.content, 'Berikut adalah kodenya:');

  assert.equal(blocks[1]?.type, 'code');
  assert.equal(blocks[1]?.language, 'typescript');
  assert.equal(blocks[1]?.content, 'const greeting = "Halo Indonesia";\nconsole.log(greeting);');

  assert.equal(blocks[2]?.type, 'paragraph');
  assert.equal(blocks[2]?.content, 'Selesai.');
});

test('MarkdownView: parse blockquotes and bullet/numbered lists', () => {
  const md = '> Ini adalah kutipan penting dari dokumen panduan.\n\n- Poin pertama\n* Poin kedua\n1. Langkah pertama';
  const blocks = parseMarkdownBlocks(md);

  assert.equal(blocks.length, 4);
  assert.deepEqual(blocks[0], {
    type: 'quote',
    content: 'Ini adalah kutipan penting dari dokumen panduan.',
  });
  assert.deepEqual(blocks[1], { type: 'list-item', content: 'Poin pertama' });
  assert.deepEqual(blocks[2], { type: 'list-item', content: 'Poin kedua' });
  assert.deepEqual(blocks[3], { type: 'list-item', content: 'Langkah pertama' });
});

test('MarkdownView: empty or whitespace string produces zero blocks', () => {
  assert.deepEqual(parseMarkdownBlocks(''), []);
  assert.deepEqual(parseMarkdownBlocks('   \n\n  '), []);
});
