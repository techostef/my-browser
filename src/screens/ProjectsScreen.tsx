import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useProjects, type Project } from '../store/projectStore';
import { loadSession } from '../lib/videoEditor/editSession';
import { useThemeColors } from '../store/settingsStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDuration(secs: number): string {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Project card ─────────────────────────────────────────────────────────────

type CardProps = {
  project: Project;
  hasSession: boolean;
  onOpen: () => void;
  onDelete: () => void;
};

function ProjectCard({ project, hasSession, onOpen, onDelete }: CardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onOpen} activeOpacity={0.8}>
      {/* Thumbnail */}
      <View style={styles.thumb}>
        {project.thumbnailUri ? (
          <Image source={{ uri: project.thumbnailUri }} style={styles.thumbImg} resizeMode="cover" />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <Text style={styles.thumbIcon}>🎬</Text>
          </View>
        )}
        {project.duration > 0 && (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{fmtDuration(project.duration)}</Text>
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.cardInfo}>
        <Text style={styles.cardName} numberOfLines={1}>{project.videoName}</Text>
        <View style={styles.cardMeta}>
          {hasSession && (
            <View style={styles.inProgressBadge}>
              <Text style={styles.inProgressText}>In progress</Text>
            </View>
          )}
          <Text style={styles.cardTime}>{timeAgo(project.updatedAt)}</Text>
        </View>
      </View>

      {/* Delete */}
      <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.deleteIcon}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProjectsScreen() {
  const { projects, removeProject } = useProjects();
  const navigation = useNavigation();
  const c = useThemeColors();
  const [sessionMap, setSessionMap] = useState<Record<string, boolean>>({});

  // Check which projects have active sessions
  useEffect(() => {
    Promise.all(
      projects.map(async p => {
        const session = await loadSession(p.videoUri);
        return [p.id, !!(session && (session.splitPoints.length > 0 || session.deletedSegments.length > 0 || session.subtitleSegments))] as [string, boolean];
      }),
    ).then(entries => setSessionMap(Object.fromEntries(entries)));
  }, [projects]);

  const handleOpen = useCallback((project: Project) => {
    (navigation as any).navigate('Trim', {
      videoUri: project.videoUri,
      duration: project.duration,
    });
  }, [navigation]);

  const handleDelete = useCallback((project: Project) => {
    Alert.alert(
      'Delete Project',
      `Delete "${project.videoName}"? Your edit progress will be lost.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => removeProject(project.id),
        },
      ],
    );
  }, [removeProject]);

  const renderItem = useCallback(({ item }: { item: Project }) => (
    <ProjectCard
      project={item}
      hasSession={sessionMap[item.id] ?? false}
      onOpen={() => handleOpen(item)}
      onDelete={() => handleDelete(item)}
    />
  ), [sessionMap, handleOpen, handleDelete]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Text style={[styles.title, { color: c.text }]}>Projects</Text>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => (navigation as any).navigate('Downloads')}
        >
          <Text style={styles.newBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {projects.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🎬</Text>
          <Text style={[styles.emptyTitle, { color: c.text }]}>No projects yet</Text>
          <Text style={[styles.emptyHint, { color: c.textSecondary }]}>
            Open the Downloads tab, tap a video, then press ✂️ Edit to start a project.
          </Text>
        </View>
      ) : (
        <FlatList
          data={projects}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const THUMB_W = 112;
const THUMB_H = 63;

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 28, fontWeight: '700' },
  newBtn: {
    backgroundColor: '#6c63ff',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  newBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  list: { padding: 12, gap: 10 },

  // Card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1c1e',
    borderRadius: 12,
    overflow: 'hidden',
    padding: 10,
    gap: 12,
  },

  // Thumbnail
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#2c2c2e',
    flexShrink: 0,
  },
  thumbImg: { width: '100%', height: '100%' },
  thumbPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbIcon: { fontSize: 28 },
  durationBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  durationText: { color: '#fff', fontSize: 10, fontWeight: '600' },

  // Info
  cardInfo: { flex: 1 },
  cardName: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 6 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inProgressBadge: {
    backgroundColor: '#2a2250',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  inProgressText: { color: '#a89fff', fontSize: 10, fontWeight: '600' },
  cardTime: { color: '#666', fontSize: 12 },

  // Delete
  deleteBtn: { padding: 4 },
  deleteIcon: { color: '#555', fontSize: 16 },

  // Empty
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyIcon: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  emptyHint: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
