/**
 * Personal AI OS — Strict GFM Markdown Parser & Sanitizer
 * Pure TypeScript AST parser: zero HTML dangerouslySetInnerHTML, zero external runtime bloat.
 * Sanitizes links, escapes all raw HTML, and extracts structured blocks for React rendering.
 */

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: InlineToken[] }
  | { type: 'italic'; children: InlineToken[] }
  | { type: 'strike'; children: InlineToken[] }
  | { type: 'inline-code'; code: string }
  | { type: 'link'; text: string; href: string; isSafe: boolean };

export type BlockToken =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: InlineToken[] }
  | { type: 'codeblock'; language: string; content: string }
  | { type: 'list'; ordered: boolean; items: InlineToken[][] }
  | { type: 'blockquote'; inlines: InlineToken[] }
  | { type: 'table'; headers: InlineToken[][]; rows: InlineToken[][][] }
  | { type: 'paragraph'; inlines: InlineToken[] };

/**
 * Validates URLs strictly: only http:// and https:// are permitted.
 * Blocks javascript:, data:, vbscript:, file:, etc.
 */
export function sanitizeUrl(rawUrl: string): { href: string; isSafe: boolean } {
  const trimmed = rawUrl.trim();
  // Strip control characters without triggering no-control-regex
  let clean = '';
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if ((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)) {
      continue;
    }
    clean += trimmed[i];
  }

  try {
    const parsed = new URL(clean);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return { href: parsed.toString(), isSafe: true };
    }
  } catch {
    // Relative URLs or invalid URL strings
    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      return { href: clean, isSafe: true };
    }
  }

  return { href: '#blocked', isSafe: false };
}

/**
 * Tokenizes an inline string into InlineTokens.
 */
export function parseInlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let index = 0;
  const len = text.length;

  while (index < len) {
    // 1. Inline code: `code`
    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1);
      if (end !== -1) {
        tokens.push({
          type: 'inline-code',
          code: text.slice(index + 1, end),
        });
        index = end + 1;
        continue;
      }
    }

    // 2. Bold: **text** or __text__
    if (
      (text.startsWith('**', index) || text.startsWith('__', index)) &&
      index + 2 < len
    ) {
      const marker = text.slice(index, index + 2);
      const end = text.indexOf(marker, index + 2);
      if (end !== -1) {
        const inner = text.slice(index + 2, end);
        tokens.push({
          type: 'bold',
          children: parseInlineTokens(inner),
        });
        index = end + 2;
        continue;
      }
    }

    // 3. Strikethrough: ~~text~~
    if (text.startsWith('~~', index) && index + 2 < len) {
      const end = text.indexOf('~~', index + 2);
      if (end !== -1) {
        const inner = text.slice(index + 2, end);
        tokens.push({
          type: 'strike',
          children: parseInlineTokens(inner),
        });
        index = end + 2;
        continue;
      }
    }

    // 4. Italic: *text* or _text_ (when not followed by another * or _)
    if (
      (text[index] === '*' || text[index] === '_') &&
      text[index + 1] !== text[index]
    ) {
      const marker = text[index] as string;
      const end = text.indexOf(marker, index + 1);
      if (end !== -1 && end > index + 1) {
        const inner = text.slice(index + 1, end);
        tokens.push({
          type: 'italic',
          children: parseInlineTokens(inner),
        });
        index = end + 1;
        continue;
      }
    }

    // 5. Link: [text](url)
    if (text[index] === '[') {
      const closingBracket = text.indexOf(']', index + 1);
      if (closingBracket !== -1 && text[closingBracket + 1] === '(') {
        const closingParen = text.indexOf(')', closingBracket + 2);
        if (closingParen !== -1) {
          const linkText = text.slice(index + 1, closingBracket);
          const rawUrl = text.slice(closingBracket + 2, closingParen);
          const { href, isSafe } = sanitizeUrl(rawUrl);

          tokens.push({
            type: 'link',
            text: linkText,
            href,
            isSafe,
          });
          index = closingParen + 1;
          continue;
        }
      }
    }

    // 6. Regular plain text accumulation
    let nextSpecial = len;
    for (let j = index + 1; j < len; j++) {
      const ch = text[j];
      if (ch === '`' || ch === '*' || ch === '_' || ch === '~' || ch === '[') {
        nextSpecial = j;
        break;
      }
    }

    const plain = text.slice(index, nextSpecial);
    if (plain.length > 0) {
      // If previous token was text, combine them
      const prev = tokens[tokens.length - 1];
      if (prev && prev.type === 'text') {
        prev.text += plain;
      } else {
        tokens.push({ type: 'text', text: plain });
      }
    }
    index = nextSpecial;
  }

  return tokens;
}

/**
 * Parses full markdown string into structured BlockTokens.
 */
export function parseMarkdown(markdown: string): BlockToken[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: BlockToken[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) {
      i++;
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // 1. Fenced Code Block: ```lang
    if (line.trim().startsWith('```')) {
      const match = line.trim().match(/^```([a-zA-Z0-9_-]*)/);
      const language = match ? match[1] : '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        const curr = lines[i];
        if (curr === undefined || curr.trim().startsWith('```')) {
          break;
        }
        codeLines.push(curr);
        i++;
      }
      if (i < lines.length && lines[i]?.trim().startsWith('```')) {
        i++; // Consume closing ```
      }
      blocks.push({
        type: 'codeblock',
        language: language || 'teks',
        content: codeLines.join('\n'),
      });
      continue;
    }

    // 2. Heading: # to ######
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch && headingMatch[1] && headingMatch[2] !== undefined) {
      const level = headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      const content = headingMatch[2].trim();
      blocks.push({
        type: 'heading',
        level,
        inlines: parseInlineTokens(content),
      });
      i++;
      continue;
    }

    // 3. Blockquote: > text
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length) {
        const curr = lines[i];
        if (curr === undefined || !curr.startsWith('>')) {
          break;
        }
        quoteLines.push(curr.replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({
        type: 'blockquote',
        inlines: parseInlineTokens(quoteLines.join('\n')),
      });
      continue;
    }

    // 4. Tables: lines containing |
    const nextLine = lines[i + 1];
    if (
      line.includes('|') &&
      nextLine !== undefined &&
      nextLine.includes('|') &&
      /^\s*\|?\s*:?-+:?\s*\|/.test(nextLine)
    ) {
      const parseCells = (row: string): InlineToken[][] => {
        const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');
        return trimmed.split('|').map((c) => parseInlineTokens(c.trim()));
      };

      const headers = parseCells(line);
      i += 2; // Skip header row and separator row
      const rows: InlineToken[][][] = [];

      while (i < lines.length) {
        const curr = lines[i];
        if (curr === undefined || !curr.includes('|') || curr.trim().length === 0) {
          break;
        }
        rows.push(parseCells(curr));
        i++;
      }

      blocks.push({
        type: 'table',
        headers,
        rows,
      });
      continue;
    }

    // 5. Unordered or Ordered Lists
    const isUnordered = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    const isOrdered = /^(\s*)\d+\.\s+(.*)$/.exec(line);

    if (isUnordered || isOrdered) {
      const ordered = Boolean(isOrdered);
      const items: InlineToken[][] = [];

      while (i < lines.length) {
        const currentLine = lines[i];
        if (currentLine === undefined) break;

        const match = ordered
          ? /^\s*\d+\.\s+(.*)$/.exec(currentLine)
          : /^\s*[-*+]\s+(.*)$/.exec(currentLine);

        if (match && match[1] !== undefined) {
          items.push(parseInlineTokens(match[1].trim()));
          i++;
        } else if (currentLine.trim() === '') {
          const peek = lines[i + 1];
          if (
            peek !== undefined &&
            (ordered ? /^\s*\d+\.\s+/.test(peek) : /^\s*[-*+]\s+/.test(peek))
          ) {
            i++;
          } else {
            break;
          }
        } else {
          break;
        }
      }

      blocks.push({
        type: 'list',
        ordered,
        items,
      });
      continue;
    }

    // 6. Regular Paragraph
    const paragraphLines: string[] = [];
    while (i < lines.length) {
      const curr = lines[i];
      if (
        curr === undefined ||
        !curr.trim() ||
        curr.trim().startsWith('```') ||
        curr.match(/^#{1,6}\s+/) ||
        curr.startsWith('>') ||
        curr.startsWith('- ') ||
        curr.startsWith('* ') ||
        /^\d+\.\s+/.test(curr)
      ) {
        break;
      }
      paragraphLines.push(curr);
      i++;
    }

    if (paragraphLines.length > 0) {
      blocks.push({
        type: 'paragraph',
        inlines: parseInlineTokens(paragraphLines.join('\n')),
      });
    }
  }

  return blocks;
}
