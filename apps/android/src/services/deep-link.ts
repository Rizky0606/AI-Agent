export type DeepLinkTarget =
  | { screen: 'Chat'; conversationId: string }
  | { screen: 'ApprovalDetail'; approvalId: string }
  | { screen: 'TaskDetail'; taskId: string }
  | { screen: 'ProjectDetail'; projectId: string }
  | { screen: 'Research'; runId: string }
  | { screen: 'Unknown'; path: string };

export class DeepLinkService {
  static parseUrl(url: string): DeepLinkTarget | null {
    if (!url) return null;

    // Support both custom scheme personal-ai:// and https://personal-ai.app/
    const normalized = url
      .replace(/^personal-ai:\/\//i, '')
      .replace(/^https?:\/\/[^/]+\//i, '')
      .replace(/^\/+/, '');

    const parts = normalized.split('/');
    const section = parts[0]?.toLowerCase();
    const id = parts[1];

    if (section === 'chat' && id) {
      return { screen: 'Chat', conversationId: id };
    }
    if ((section === 'approvals' || section === 'approval') && id) {
      return { screen: 'ApprovalDetail', approvalId: id };
    }
    if ((section === 'tasks' || section === 'task') && id) {
      return { screen: 'TaskDetail', taskId: id };
    }
    if ((section === 'projects' || section === 'project') && id) {
      return { screen: 'ProjectDetail', projectId: id };
    }
    if ((section === 'research' || section === 'riset') && id) {
      return { screen: 'Research', runId: id };
    }

    return { screen: 'Unknown', path: normalized };
  }
}
