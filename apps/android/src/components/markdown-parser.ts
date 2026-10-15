export interface MarkdownBlock {
  type: 'heading' | 'code' | 'quote' | 'list-item' | 'paragraph';
  level?: number;
  language?: string;
  content: string;
}

/**
 * Tokenizes markdown string into high-level structural blocks.
 */
export function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  if (!text) return [];

  const blocks: MarkdownBlock[] = [];
  const lines = text.split('\n');
  let inCodeBlock = false;
  let codeLanguage = '';
  let codeLines: string[] = [];
  let paragraphLines: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      const content = paragraphLines.join('\n').trim();
      if (content) {
        blocks.push({ type: 'paragraph', content });
      }
      paragraphLines = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Check for fenced code block toggle
    const codeMatch = line.match(/^```\s*([\w-]*)/);
    if (codeMatch) {
      if (inCodeBlock) {
        // Closing code block
        blocks.push({
          type: 'code',
          language: codeLanguage || 'text',
          content: codeLines.join('\n'),
        });
        inCodeBlock = false;
        codeLanguage = '';
        codeLines = [];
      } else {
        // Opening code block
        flushParagraph();
        inCodeBlock = true;
        codeLanguage = codeMatch[1]?.toLowerCase() || '';
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headings: #, ##, ###
    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: headingMatch[1]!.length,
        content: headingMatch[2]!.trim(),
      });
      continue;
    }

    // Blockquote: > text
    if (line.startsWith('>')) {
      flushParagraph();
      blocks.push({
        type: 'quote',
        content: line.replace(/^>\s?/, '').trim(),
      });
      continue;
    }

    // List item: - text, * text, or 1. text
    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      blocks.push({
        type: 'list-item',
        content: listMatch[3]!.trim(),
      });
      continue;
    }

    // Empty line separates paragraphs
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    // Regular line in paragraph
    paragraphLines.push(line);
  }

  // Flush any trailing elements
  if (inCodeBlock) {
    blocks.push({
      type: 'code',
      language: codeLanguage || 'text',
      content: codeLines.join('\n'),
    });
  } else {
    flushParagraph();
  }

  return blocks;
}
