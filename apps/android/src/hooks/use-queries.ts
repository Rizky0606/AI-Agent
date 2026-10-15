import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { defaultApiClient } from '../api/client.ts';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  },
});

// --- Projects ---
export const useProjects = () =>
  useQuery({
    queryKey: ['projects'],
    queryFn: () => defaultApiClient.listProjects().then((r) => r.projects),
  });

export const useProject = (id: string) =>
  useQuery({
    queryKey: ['projects', id],
    queryFn: () => defaultApiClient.getProject(id).then((r) => r.project),
    enabled: Boolean(id),
  });

export const useCreateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string | undefined }) =>
      defaultApiClient.createProject(data.name, data.description).then((r) => r.project),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
};

// --- Conversations ---
export const useConversations = (projectId?: string | undefined) =>
  useQuery({
    queryKey: ['conversations', { projectId }],
    queryFn: () =>
      projectId
        ? defaultApiClient.listProjectConversations(projectId).then((r) => r.conversations)
        : defaultApiClient.listConversations().then((r) => r.conversations),
  });

export const useConversation = (id: string) =>
  useQuery({
    queryKey: ['conversations', id],
    queryFn: () => defaultApiClient.getConversation(id).then((r) => r.conversation),
    enabled: Boolean(id),
  });

export const useMessages = (conversationId: string) =>
  useQuery({
    queryKey: ['messages', conversationId],
    queryFn: () => defaultApiClient.listMessages(conversationId).then((r) => r.messages),
    enabled: Boolean(conversationId),
  });

export const useCreateConversation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { projectId?: string | undefined; title?: string | undefined }) => {
      if (data.projectId) {
        return defaultApiClient
          .createProjectConversation(data.projectId, data.title)
          .then((r) => r.conversation);
      }
      return defaultApiClient.createProjectConversation('', data.title).then((r) => r.conversation);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });
};

// --- Tasks ---
export const useTasks = (
  filters?: { projectId?: string | undefined; status?: string | undefined; conversationId?: string | undefined } | undefined,
) =>
  useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => defaultApiClient.listTasks(filters).then((r) => r.tasks),
  });

export const useTask = (id: string) =>
  useQuery({
    queryKey: ['tasks', id],
    queryFn: () => defaultApiClient.getTask(id),
    enabled: Boolean(id),
  });

export const useTaskEvents = (taskId: string) =>
  useQuery({
    queryKey: ['tasks', taskId, 'events'],
    queryFn: () => defaultApiClient.getTaskEvents(taskId).then((r) => r.events),
    enabled: Boolean(taskId),
  });

export const useCreateTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      projectId: string;
      kind: string;
      payload?: Record<string, unknown> | undefined;
      conversationId?: string | undefined;
      priority?: number | undefined;
    }) => defaultApiClient.createTask(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
};

export const usePauseTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => defaultApiClient.pauseTask(taskId),
    onSuccess: (_, taskId) => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks', taskId] });
    },
  });
};

export const useResumeTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => defaultApiClient.resumeTask(taskId),
    onSuccess: (_, taskId) => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks', taskId] });
    },
  });
};

export const useCancelTask = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => defaultApiClient.cancelTask(taskId),
    onSuccess: (_, taskId) => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks', taskId] });
    },
  });
};

// --- Approvals ---
export const useApprovals = (status?: string | undefined) =>
  useQuery({
    queryKey: ['approvals', { status }],
    queryFn: () => defaultApiClient.listApprovals({ status }).then((r) => r.approvals),
  });

export const useApproval = (id: string) =>
  useQuery({
    queryKey: ['approvals', id],
    queryFn: () => defaultApiClient.getApproval(id),
    enabled: Boolean(id),
  });

export const useApproveRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { approvalId: string; reason?: string | undefined }) =>
      defaultApiClient.approve(data.approvalId, data.reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
};

export const useDenyRequest = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { approvalId: string; reason?: string | undefined }) =>
      defaultApiClient.deny(data.approvalId, data.reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
};

// --- Health / Status ---
export const useHealth = () =>
  useQuery({
    queryKey: ['health'],
    queryFn: () => defaultApiClient.checkHealth(),
    refetchInterval: 30_000,
  });
