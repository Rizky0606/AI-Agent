import { create } from 'zustand';

export interface UiState {
  activeProjectId: string | null;
  taskStatusFilter: string | null;
  approvalStatusFilter: string | null;
  theme: 'dark' | 'light';
  fcmToken: string | null;
  pushNotificationsEnabled: boolean;
  notifyApprovalRequired: boolean;
  notifyTaskUpdates: boolean;
  notifyBlockers: boolean;
  toastMessage: string | null;

  // Actions
  setActiveProjectId: (id: string | null) => void;
  setTaskStatusFilter: (status: string | null) => void;
  setApprovalStatusFilter: (status: string | null) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setFcmToken: (token: string | null) => void;
  setPushNotificationsEnabled: (enabled: boolean) => void;
  setNotifyApprovalRequired: (enabled: boolean) => void;
  setNotifyTaskUpdates: (enabled: boolean) => void;
  setNotifyBlockers: (enabled: boolean) => void;
  showToast: (message: string) => void;
  clearToast: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeProjectId: null,
  taskStatusFilter: null,
  approvalStatusFilter: 'pending',
  theme: 'dark',
  fcmToken: null,
  pushNotificationsEnabled: true,
  notifyApprovalRequired: true,
  notifyTaskUpdates: true,
  notifyBlockers: true,
  toastMessage: null,

  setActiveProjectId: (activeProjectId) => set({ activeProjectId }),
  setTaskStatusFilter: (taskStatusFilter) => set({ taskStatusFilter }),
  setApprovalStatusFilter: (approvalStatusFilter) => set({ approvalStatusFilter }),
  setTheme: (theme) => set({ theme }),
  setFcmToken: (fcmToken) => set({ fcmToken }),
  setPushNotificationsEnabled: (pushNotificationsEnabled) => set({ pushNotificationsEnabled }),
  setNotifyApprovalRequired: (notifyApprovalRequired) => set({ notifyApprovalRequired }),
  setNotifyTaskUpdates: (notifyTaskUpdates) => set({ notifyTaskUpdates }),
  setNotifyBlockers: (notifyBlockers) => set({ notifyBlockers }),
  showToast: (toastMessage) => set({ toastMessage }),
  clearToast: () => set({ toastMessage: null }),
}));
