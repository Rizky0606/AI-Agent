/**
 * Personal AI OS — Tipe-tipe Integrasi Channel Telegram (Sesi 11)
 */

export type TelegramChannelMode = 'notification-only' | 'interactive-chat';

export interface TelegramChannelConfig {
  mode: TelegramChannelMode;
  botToken?: string | undefined;
  secretToken?: string | undefined;
  webhookUrl?: string | undefined;
  maxMessageLength?: number | undefined; // Default 4096
  rateLimitPerMinute?: number | undefined; // Default 10
  allowedChatIds?: string[] | undefined;
}

export interface TelegramChannelStatus {
  channel: 'telegram';
  configured: boolean;
  mode: TelegramChannelMode;
  botConfigured: boolean;
  interactiveChatBlocked: boolean;
  interactiveChatBlockedReason?: string | undefined;
  pairedChatsCount: number;
  features: {
    outboundAlerts: boolean;
    approvalDeepLinks: boolean;
    interactiveCommands: boolean;
    inboundAgentExecution: boolean;
  };
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string | undefined;
  username?: string | undefined;
  language_code?: string | undefined;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string | undefined;
  username?: string | undefined;
  first_name?: string | undefined;
  last_name?: string | undefined;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser | undefined;
  chat: TelegramChat;
  date: number;
  text?: string | undefined;
  caption?: string | undefined;
  photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }> | undefined;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number } | undefined;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage | undefined;
  edited_message?: TelegramMessage | undefined;
}

export interface NormalizedChannelAttachment {
  type: 'image' | 'document';
  fileId: string;
  fileName?: string | undefined;
  mimeType?: string | undefined;
  fileSizeBytes?: number | undefined;
}

export interface NormalizedChannelMessage {
  id: string;
  channel: 'telegram';
  originatingChatId: string;
  senderId: string;
  senderUsername?: string | undefined;
  userId: string; // Paired user ID in Personal AI OS
  conversationId?: string | undefined;
  text: string;
  attachments: NormalizedChannelAttachment[];
  correlationId: string;
  updateId: number;
  receivedAt: string; // ISO 8601
}

export interface ChannelPairingRecord {
  id: string;
  userId: string;
  channel: 'telegram';
  channelChatId: string;
  channelUsername?: string | undefined;
  pairedAt: string;
  status: 'active' | 'revoked';
  metadata?: Record<string, unknown> | undefined;
}

export interface PairingCodeRecord {
  code: string;
  userId: string;
  expiresAt: number; // Unix timestamp ms
}
