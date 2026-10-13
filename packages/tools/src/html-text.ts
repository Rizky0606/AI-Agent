const SCRIPT_BLOCK = /<(script|style|noscript|template|svg)[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;
const TAG = /<[^>]*>/g;

function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Extracts readable text from HTML. Script, style, and template bodies are removed before tags,
 * otherwise minified JavaScript lands in the output and reads like prose.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html.replace(SCRIPT_BLOCK, ' ').replace(COMMENT, ' ').replace(TAG, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text of the page `<title>`, or an empty string when the document has none. */
export function htmlTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? htmlToText(match[1] ?? '') : '';
}
