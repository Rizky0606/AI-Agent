import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { MessageAttachment } from '../api/types.ts';
import { StatusPill } from '../components/StatusPill.tsx';
import { theme } from '../components/Theme.ts';
import { useMessages } from '../hooks/use-queries.ts';
import { ChatWebSocketClient } from '../services/chat-websocket.ts';
import { useChatStore } from '../state/chat-store.ts';

export interface ChatScreenProps {
  conversationId: string;
  conversationTitle?: string | undefined;
  onBack: () => void;
}

export const ChatScreen: React.FC<ChatScreenProps> = ({
  conversationId,
  conversationTitle,
  onBack,
}) => {
  const {
    messages,
    setMessages,
    isStreaming,
    streamingDelta,
    draftText,
    setDraftText,
    draftAttachments,
    addDraftAttachment,
    clearDraft,
    connectionStatus,
    setConversationId,
  } = useChatStore();

  const { data: initialMessages, isLoading: isLoadingInitial } = useMessages(conversationId);
  const wsClientRef = useRef<ChatWebSocketClient | null>(null);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    setConversationId(conversationId);

    const ws = new ChatWebSocketClient({ conversationId });
    wsClientRef.current = ws;
    void ws.connect();

    return () => {
      ws.disconnect();
    };
  }, [conversationId, setConversationId]);

  useEffect(() => {
    if (initialMessages && initialMessages.length > 0 && messages.length === 0) {
      setMessages(initialMessages);
    }
  }, [initialMessages, messages.length, setMessages]);

  const handleSend = () => {
    const trimmed = draftText.trim();
    if (!trimmed || !wsClientRef.current) return;

    // Optimistic user message append
    useChatStore.getState().appendMessage({
      id: `client-msg-${Date.now()}`,
      conversationId,
      role: 'user',
      content: trimmed,
      attachments: draftAttachments.length > 0 ? draftAttachments : undefined,
      createdAt: new Date().toISOString(),
    });

    wsClientRef.current.sendMessage({
      content: trimmed,
      attachments: draftAttachments.length > 0 ? draftAttachments : undefined,
    });

    clearDraft();
  };

  const handleCancel = () => {
    if (wsClientRef.current) {
      wsClientRef.current.cancelActiveStream();
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      {/* Chat Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {conversationTitle || 'Percakapan Asisten'}
          </Text>
          <StatusPill status={connectionStatus} />
        </View>
      </View>

      {/* Message List */}
      {isLoadingInitial && messages.length === 0 ? (
        <View style={styles.centerLoading}>
          <ActivityIndicator color={theme.colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => {
            const isUser = item.role === 'user';
            return (
              <View
                style={[styles.bubbleContainer, isUser ? styles.userAlign : styles.assistantAlign]}
              >
                <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
                  <Text
                    style={[styles.bubbleText, isUser ? styles.userText : styles.assistantText]}
                  >
                    {item.content}
                  </Text>
                  {item.attachments && item.attachments.length > 0 ? (
                    <View style={styles.attachmentList}>
                      {item.attachments.map((att: MessageAttachment, idx: number) => (
                        <Text key={idx} style={styles.attachmentPill}>
                          📎 {att.name || att.type}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  <Text style={styles.messageTime}>
                    {new Date(item.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                </View>
              </View>
            );
          }}
          ListFooterComponent={
            isStreaming ? (
              <View style={[styles.bubbleContainer, styles.assistantAlign]}>
                <View style={[styles.bubble, styles.assistantBubble, styles.streamingBubble]}>
                  <Text style={[styles.bubbleText, styles.assistantText]}>
                    {streamingDelta || 'Mengetik...'}
                  </Text>
                  <View style={styles.streamingIndicatorRow}>
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                    <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
                      <Text style={styles.cancelButtonText}>Batalkan</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ) : null
          }
        />
      )}

      {/* Input bar */}
      <View style={styles.inputBar}>
        {draftAttachments.length > 0 ? (
          <View style={styles.draftAttachmentsRow}>
            {draftAttachments.map((att, i) => (
              <Text key={i} style={styles.draftAttachmentTag}>
                📎 {att.name || att.type}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.inputControlsRow}>
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={() => {
              // Simulation / selector for image/document attachment
              addDraftAttachment({
                type: 'image',
                url: 'https://placeholder.local/image.png',
                mimeType: 'image/png',
                name: 'screenshot.png',
              });
            }}
          >
            <Text style={styles.attachBtnText}>📎</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.textInput}
            value={draftText}
            onChangeText={setDraftText}
            placeholder="Ketik pesan untuk asisten..."
            placeholderTextColor={theme.colors.textMuted}
            multiline
            maxLength={4000}
          />

          <TouchableOpacity
            style={[styles.sendBtn, (!draftText.trim() || isStreaming) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!draftText.trim() || isStreaming}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.surfaceBorder,
  },
  backButton: {
    padding: theme.spacing.xs,
    marginRight: theme.spacing.sm,
  },
  backButtonText: {
    color: theme.colors.primary,
    fontSize: 22,
    fontWeight: 'bold',
  },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: theme.colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    marginRight: theme.spacing.md,
  },
  centerLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageList: {
    padding: theme.spacing.md,
  },
  bubbleContainer: {
    marginBottom: theme.spacing.md,
    maxWidth: '85%',
  },
  userAlign: {
    alignSelf: 'flex-end',
  },
  assistantAlign: {
    alignSelf: 'flex-start',
  },
  bubble: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
  },
  userBubble: {
    backgroundColor: theme.colors.primary,
    borderBottomRightRadius: 2,
  },
  assistantBubble: {
    backgroundColor: theme.colors.surfaceElevated,
    borderBottomLeftRadius: 2,
    borderWidth: 1,
    borderColor: theme.colors.surfaceBorder,
  },
  streamingBubble: {
    borderColor: theme.colors.primary,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 20,
  },
  userText: {
    color: '#fff',
  },
  assistantText: {
    color: theme.colors.textPrimary,
  },
  messageTime: {
    fontSize: 10,
    color: theme.colors.textMuted,
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  attachmentList: {
    marginTop: theme.spacing.xs,
  },
  attachmentPill: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    backgroundColor: 'rgba(0,0,0,0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  streamingIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.spacing.xs,
  },
  cancelButton: {
    backgroundColor: theme.colors.dangerBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.danger,
  },
  cancelButtonText: {
    color: theme.colors.danger,
    fontSize: 11,
    fontWeight: '600',
  },
  inputBar: {
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.surfaceBorder,
    padding: theme.spacing.sm,
  },
  draftAttachmentsRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.xs,
  },
  draftAttachmentTag: {
    fontSize: 11,
    color: theme.colors.primary,
    backgroundColor: theme.colors.surfaceElevated,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 6,
  },
  inputControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  attachBtn: {
    padding: theme.spacing.sm,
    marginRight: theme.spacing.xs,
  },
  attachBtnText: {
    fontSize: 20,
  },
  textInput: {
    flex: 1,
    backgroundColor: theme.colors.surfaceElevated,
    color: theme.colors.textPrimary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 8,
    borderRadius: theme.borderRadius.full,
    maxHeight: 100,
    fontSize: 14,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: theme.spacing.xs,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
});
