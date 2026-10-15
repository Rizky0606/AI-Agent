import type { ChatConversation } from '../../state/agent-store.ts';

export type ConversationGroup = 'today' | 'yesterday' | 'older';

export interface GroupedConversations {
  today: ChatConversation[];
  yesterday: ChatConversation[];
  older: ChatConversation[];
}

/**
 * Groups conversations into 'today', 'yesterday', and 'older'
 * based on their createdAt timestamp compared to a reference date.
 */
export function groupConversations(
  conversations: ChatConversation[],
  referenceDate: Date = new Date(),
): GroupedConversations {
  const ref = new Date(referenceDate);
  const startOfToday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000; // 24 hours in milliseconds

  const grouped: GroupedConversations = {
    today: [],
    yesterday: [],
    older: [],
  };

  for (const item of conversations) {
    if (!item.id) continue;
    // Draft or missing timestamps default to now (today)
    const time = item.createdAt ? new Date(item.createdAt).getTime() : startOfToday + 1000;

    if (time >= startOfToday) {
      grouped.today.push(item);
    } else if (time >= startOfYesterday) {
      grouped.yesterday.push(item);
    } else {
      grouped.older.push(item);
    }
  }

  return grouped;
}
