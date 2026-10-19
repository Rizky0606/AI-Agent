import React, { useState } from 'react';
import {
  Clipboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Check, Copy } from 'lucide-react-native';
import { useAppTheme } from '../hooks/use-theme.ts';
import { parseMarkdownBlocks, type MarkdownBlock } from './markdown-parser.ts';

export type { MarkdownBlock };
export { parseMarkdownBlocks };

/**
 * Parses inline formatting: `code`, **bold**, *italic*, and plain text.
 */
export function renderInlineFormatted(
  text: string,
  baseStyle: object,
  keyPrefix: string,
  theme: ReturnType<typeof useAppTheme>,
): React.ReactNode[] {
  // Regex pattern for inline code, bold, and italic
  // 1: `inline code`
  // 2: **bold**
  // 3: *italic*
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(pattern);

  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;

    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const codeText = part.slice(1, -1);
      return (
        <Text
          key={key}
          style={[
            baseStyle,
            {
              fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              backgroundColor: theme.colors.surfaceElevated,
              color: theme.colors.primary,
              fontSize: 12,
              paddingHorizontal: 4,
              borderRadius: 3,
            },
          ]}
        >
          {` ${codeText} `}
        </Text>
      );
    }

    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return (
        <Text key={key} style={[baseStyle, { fontWeight: '700' }]}>
          {part.slice(2, -2)}
        </Text>
      );
    }

    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return (
        <Text key={key} style={[baseStyle, { fontStyle: 'italic' }]}>
          {part.slice(1, -1)}
        </Text>
      );
    }

    return (
      <Text key={key} style={baseStyle}>
        {part}
      </Text>
    );
  });
}

export interface MarkdownViewProps {
  content: string;
  textColor?: string;
  onCopyNotice?: (text: string) => void;
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({
  content,
  textColor,
  onCopyNotice,
}) => {
  const theme = useAppTheme();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const blocks = parseMarkdownBlocks(content);
  const resolvedTextColor = textColor ?? theme.colors.textPrimary;

  const handleCopyCode = (code: string, index: number) => {
    try {
      Clipboard.setString(code);
      setCopiedIndex(index);
      if (onCopyNotice) {
        onCopyNotice('Kode disalin ke papan klip');
      }
      setTimeout(() => {
        setCopiedIndex((current) => (current === index ? null : current));
      }, 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <View style={styles.container}>
      {blocks.map((block, index) => {
        const key = `block-${index}`;

        switch (block.type) {
          case 'heading': {
            const headingFontSize =
              block.level === 1 ? 20 : block.level === 2 ? 17 : 15;
            return (
              <View key={key} style={styles.headingWrapper}>
                <Text
                  style={[
                    styles.headingText,
                    {
                      fontSize: headingFontSize,
                      color: resolvedTextColor,
                    },
                  ]}
                  accessibilityRole="header"
                >
                  {block.content}
                </Text>
              </View>
            );
          }

          case 'code': {
            const isCopied = copiedIndex === index;
            return (
              <View
                key={key}
                style={[
                  styles.codeBlock,
                  {
                    backgroundColor: theme.colors.surfaceElevated,
                    borderColor: theme.colors.surfaceBorder,
                  },
                ]}
              >
                <View
                  style={[
                    styles.codeHeader,
                    { borderBottomColor: theme.colors.surfaceBorder },
                  ]}
                >
                  <Text style={[styles.codeLanguage, { color: theme.colors.textMuted }]}>
                    {block.language || 'code'}
                  </Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Salin blok kode ${block.language}`}
                    style={styles.copyButton}
                    onPress={() => handleCopyCode(block.content, index)}
                  >
                    {isCopied ? (
                      <Check size={14} color={theme.colors.success} />
                    ) : (
                      <Copy size={14} color={theme.colors.textSecondary} />
                    )}
                    <Text
                      style={[
                        styles.copyText,
                        {
                          color: isCopied
                            ? theme.colors.success
                            : theme.colors.textSecondary,
                        },
                      ]}
                    >
                      {isCopied ? 'Tersalin' : 'Salin'}
                    </Text>
                  </TouchableOpacity>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  nestedScrollEnabled
                  contentContainerStyle={{ flexGrow: 1 }}
                >
                  <Text
                    selectable
                    allowFontScaling
                    style={[
                      styles.codeContent,
                      {
                        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                        color: theme.colors.textPrimary,
                      },
                    ]}
                  >
                    {block.content}
                  </Text>
                </ScrollView>
              </View>
            );
          }

          case 'quote': {
            return (
              <View
                key={key}
                style={[
                  styles.quoteBlock,
                  {
                    borderLeftColor: theme.colors.primary,
                    backgroundColor: theme.colors.surfaceElevated,
                  },
                ]}
              >
                <Text style={[styles.quoteText, { color: theme.colors.textSecondary }]}>
                  {block.content}
                </Text>
              </View>
            );
          }

          case 'list-item': {
            return (
              <View key={key} style={styles.listItemRow}>
                <Text style={[styles.listBullet, { color: theme.colors.primary }]}>•</Text>
                <Text style={[styles.listItemText, { color: resolvedTextColor }]}>
                  {renderInlineFormatted(
                    block.content,
                    { color: resolvedTextColor, fontSize: 14, lineHeight: 21 },
                    key,
                    theme,
                  )}
                </Text>
              </View>
            );
          }

          case 'paragraph':
          default: {
            return (
              <Text key={key} style={[styles.paragraph, { color: resolvedTextColor }]}>
                {renderInlineFormatted(
                  block.content,
                  { color: resolvedTextColor, fontSize: 14, lineHeight: 21 },
                  key,
                  theme,
                )}
              </Text>
            );
          }
        }
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  headingWrapper: {
    marginTop: 8,
    marginBottom: 4,
  },
  headingText: {
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  paragraph: {
    marginBottom: 8,
    fontSize: 14,
    lineHeight: 21,
  },
  listItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
    paddingLeft: 4,
  },
  listBullet: {
    fontSize: 16,
    marginRight: 8,
    lineHeight: 20,
  },
  listItemText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
  },
  quoteBlock: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 6,
    marginVertical: 6,
    borderRadius: 4,
  },
  quoteText: {
    fontStyle: 'italic',
    fontSize: 13,
    lineHeight: 19,
  },
  codeBlock: {
    borderRadius: 8,
    borderWidth: 1,
    marginVertical: 8,
    overflow: 'hidden',
  },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    height: 48, // 48dp minimum touch target for header/copy button
  },
  codeLanguage: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  copyText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  codeContent: {
    padding: 12,
    fontSize: 12,
    lineHeight: 18,
  },
});
