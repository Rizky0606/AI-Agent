import React from 'react';
import {
  Alert,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { ExternalLink, ShieldCheck, X } from 'lucide-react-native';
import type { ResearchSourceItem } from '@personal-ai-os/shared';
import { useAppTheme } from '../hooks/use-theme.ts';
import { idID } from '../locales/id-ID.ts';

interface SourceBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  source: ResearchSourceItem | null;
  quote?: string | null | undefined;
  citationNumber?: number | undefined;
}

export const SourceBottomSheet: React.FC<SourceBottomSheetProps> = ({
  isOpen,
  onClose,
  source,
  quote,
  citationNumber,
}) => {
  const theme = useAppTheme();

  if (!isOpen || !source) return null;

  const handleOpenExternal = () => {
    Alert.alert(
      idID.research.report.openExternalConfirmation,
      `${idID.research.report.openExternalWarning}\n\n${source.url}`,
      [
        { text: idID.research.report.cancelOpen, style: 'cancel' },
        {
          text: idID.research.report.confirmOpen,
          onPress: () => {
            void Linking.openURL(source.url);
          },
        },
      ],
    );
  };

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
            <View style={[styles.sheetContainer, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
              {/* Sheet Drag Handle */}
              <View style={styles.handleContainer}>
                <View style={[styles.handleBar, { backgroundColor: theme.colors.surfaceBorder }]} />
              </View>

              {/* Sheet Header */}
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  {citationNumber !== undefined && (
                    <View style={[styles.citationBadge, { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary }]}>
                      <Text style={[styles.citationBadgeText, { color: theme.colors.primary }]}>
                        [src-{citationNumber}]
                      </Text>
                    </View>
                  )}
                  <View style={[styles.domainBadge, { backgroundColor: theme.colors.surface }]}>
                    <Text style={[styles.domainInitials, { color: theme.colors.primary }]}>{source.initials}</Text>
                    <Text style={[styles.domainName, { color: theme.colors.textSecondary }]}>{source.domain}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Tutup"
                >
                  <X size={18} color={theme.colors.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Source Title & Meta */}
              <Text style={[styles.title, { color: theme.colors.textPrimary }]} allowFontScaling>
                {source.title}
              </Text>

              <View style={styles.metaRow}>
                <ShieldCheck size={14} color={theme.colors.success} />
                <Text style={[styles.credibilityText, { color: theme.colors.textSecondary }]} allowFontScaling>
                  Tingkat Kredibilitas: {Math.round(source.credibilityScore * 100)}%
                </Text>
              </View>

              {/* Quote Snippet Box if available */}
              {quote ? (
                <View style={[styles.quoteCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.primary }]}>
                  <Text style={[styles.quoteLabel, { color: theme.colors.textMuted }]}>Kutipan Bukti Faktual:</Text>
                  <Text style={[styles.quoteText, { color: theme.colors.textPrimary }]} allowFontScaling>
                    "{quote}"
                  </Text>
                </View>
              ) : source.snippet ? (
                <View style={[styles.quoteCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
                  <Text style={[styles.quoteLabel, { color: theme.colors.textMuted }]}>Ringkasan Konten:</Text>
                  <Text style={[styles.quoteText, { color: theme.colors.textSecondary }]} allowFontScaling>
                    {source.snippet}
                  </Text>
                </View>
              ) : null}

              {/* Open in external browser button */}
              <TouchableOpacity
                style={[styles.openBtn, { backgroundColor: theme.colors.primary }]}
                onPress={handleOpenExternal}
                accessibilityRole="button"
                accessibilityLabel="Buka tautan asli di peramban sistem"
              >
                <ExternalLink size={16} color="#ffffff" />
                <Text style={styles.openBtnText} allowFontScaling>
                  Buka Tautan di Peramban
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    padding: 18,
    paddingBottom: 32,
    maxHeight: '80%',
  },
  handleContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  citationBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  citationBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  domainBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 4,
  },
  domainInitials: {
    fontSize: 12,
    fontWeight: '700',
  },
  domainName: {
    fontSize: 12,
  },
  closeBtn: {
    padding: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 22,
    marginBottom: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
  },
  credibilityText: {
    fontSize: 12,
  },
  quoteCard: {
    padding: 12,
    borderRadius: 10,
    borderLeftWidth: 3,
    marginBottom: 18,
  },
  quoteLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  quoteText: {
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 19,
  },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  openBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});
