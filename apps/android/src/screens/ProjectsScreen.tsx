import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader.tsx';
import { useAppTheme } from '../hooks/use-theme.ts';
import { useCreateProject, useProjects } from '../hooks/use-queries.ts';
import { useUiStore } from '../state/ui-store.ts';

export interface ProjectsScreenProps {
  onBack?: () => void;
}

export const ProjectsScreen: React.FC<ProjectsScreenProps> = ({ onBack }) => {
  const theme = useAppTheme();
  const { data: projects, isLoading, refetch } = useProjects();
  const { activeProjectId, setActiveProjectId } = useUiStore();
  const createProject = useCreateProject();

  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleCreate = async () => {
    if (!name.trim()) return;
    await createProject.mutateAsync({
      name: name.trim(),
      description: description.trim() || undefined,
    });
    setName('');
    setDescription('');
    setModalVisible(false);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <ScreenHeader
        title="Workspaces & Projects"
        onBack={onBack}
        rightElement={
          <Pressable
            android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
            style={[styles.addButton, { backgroundColor: theme.colors.primary }]}
            onPress={() => setModalVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Buat workspace baru"
          >
            <Text style={styles.addButtonText} allowFontScaling>
              + Buat Baru
            </Text>
          </Pressable>
        }
      />

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator color={theme.colors.primary} size="large" />
        </View>
      ) : projects?.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text
            style={[styles.emptyTitle, { color: theme.colors.textPrimary }]}
            allowFontScaling
          >
            Belum Ada Project
          </Text>
          <Text
            style={[styles.emptySubtitle, { color: theme.colors.textSecondary }]}
            allowFontScaling
          >
            Kelompokkan task dan percakapan Anda dalam workspace
          </Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(item) => item.id}
          onRefresh={refetch}
          refreshing={isLoading}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isActive = activeProjectId === item.id;
            return (
              <View
                style={[
                  styles.projectCard,
                  {
                    backgroundColor: theme.colors.surface,
                    borderColor: isActive ? theme.colors.primary : theme.colors.surfaceBorder,
                  },
                ]}
              >
                <View style={styles.cardHeader}>
                  <Text
                    style={[styles.projectName, { color: theme.colors.textPrimary }]}
                    allowFontScaling
                  >
                    {item.name}
                  </Text>
                  {isActive ? (
                    <View style={[styles.activeBadge, { backgroundColor: theme.colors.primary }]}>
                      <Text style={styles.activeBadgeText} allowFontScaling>
                        AKTIF
                      </Text>
                    </View>
                  ) : null}
                </View>
                {item.description ? (
                  <Text
                    style={[styles.projectDesc, { color: theme.colors.textSecondary }]}
                    allowFontScaling
                  >
                    {item.description}
                  </Text>
                ) : null}
                <View style={styles.cardFooter}>
                  <Text
                    style={[styles.dateText, { color: theme.colors.textMuted }]}
                    allowFontScaling
                  >
                    Dibuat: {new Date(item.createdAt).toLocaleDateString('id-ID')}
                  </Text>
                  <Pressable
                    android_ripple={{ color: 'rgba(128, 128, 128, 0.2)' }}
                    style={[
                      styles.selectBtn,
                      {
                        backgroundColor: isActive
                          ? 'transparent'
                          : theme.colors.surfaceElevated,
                        borderColor: theme.colors.primary,
                        borderWidth: isActive ? 1 : 0,
                      },
                    ]}
                    onPress={() => setActiveProjectId(isActive ? null : item.id)}
                    accessibilityRole="button"
                    accessibilityLabel={isActive ? 'Batal Pilih Workspace' : 'Pilih Workspace'}
                  >
                    <Text
                      style={[
                        styles.selectBtnText,
                        { color: isActive ? theme.colors.textSecondary : theme.colors.primary },
                      ]}
                      allowFontScaling
                    >
                      {isActive ? 'Batal Pilih' : 'Pilih Workspace'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Create Project Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: theme.colors.surface,
                borderColor: theme.colors.surfaceBorder,
              },
            ]}
          >
            <Text
              style={[styles.modalTitle, { color: theme.colors.textPrimary }]}
              allowFontScaling
            >
              Buat Workspace Baru
            </Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.surfaceBorder,
                  color: theme.colors.textPrimary,
                },
              ]}
              placeholder="Nama Project"
              placeholderTextColor={theme.colors.textMuted}
              value={name}
              onChangeText={setName}
              accessibilityLabel="Nama Project"
            />
            <TextInput
              style={[
                styles.modalInput,
                styles.textArea,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.surfaceBorder,
                  color: theme.colors.textPrimary,
                },
              ]}
              placeholder="Deskripsi (opsional)"
              placeholderTextColor={theme.colors.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              accessibilityLabel="Deskripsi Project"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Batal"
              >
                <Text
                  style={[styles.cancelBtnText, { color: theme.colors.textSecondary }]}
                  allowFontScaling
                >
                  Batal
                </Text>
              </TouchableOpacity>
              <Pressable
                android_ripple={{ color: 'rgba(255, 255, 255, 0.2)' }}
                style={[
                  styles.saveBtn,
                  { backgroundColor: theme.colors.primary },
                  !name.trim() && styles.btnDisabled,
                ]}
                disabled={!name.trim()}
                onPress={handleCreate}
                accessibilityRole="button"
                accessibilityLabel="Simpan workspace"
              >
                <Text style={styles.saveBtnText} allowFontScaling>
                  Simpan
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  addButton: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
  listContent: {
    padding: 16,
  },
  projectCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  projectName: {
    fontSize: 16,
    fontWeight: '700',
  },
  activeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  activeBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  projectDesc: {
    fontSize: 13,
    marginBottom: 10,
    lineHeight: 18,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  dateText: {
    fontSize: 11,
  },
  selectBtn: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    padding: 20,
    borderRadius: 14,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 14,
  },
  modalInput: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 14,
    fontSize: 14,
    minHeight: 48,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  cancelBtn: {
    minHeight: 48,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
  },
  saveBtn: {
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    color: '#fff',
    fontWeight: '700',
  },
});
