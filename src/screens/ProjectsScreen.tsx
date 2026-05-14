import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  RewardedInterstitialAd,
  RewardedAdEventType,
  AdEventType,
} from 'react-native-google-mobile-ads';
import { REWARDED_INTERSTITIAL_AD_UNIT_ID } from '../config/admob';
import { useProjects, type Project } from '../store/projectStore';
import { loadSession } from '../lib/videoEditor/editSession';
import { useThemeColors } from '../store/settingsStore';
import { AdBanner } from '../components/AdBanner';

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
  isSelectionMode: boolean;
  isSelected: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onLongPress: () => void;
  onToggleSelect: () => void;
};

function ProjectCard({ project, hasSession, isSelectionMode, isSelected, onOpen, onDelete, onLongPress, onToggleSelect }: CardProps) {
  const handlePress = isSelectionMode ? onToggleSelect : onOpen;

  return (
    <TouchableOpacity
      style={[styles.card, isSelected && styles.cardSelected]}
      onPress={handlePress}
      onLongPress={onLongPress}
      activeOpacity={0.8}
    >
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

      {/* Right side: checkbox in selection mode, delete button otherwise */}
      {isSelectionMode ? (
        <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
          {isSelected && <Text style={styles.checkmark}>✓</Text>}
        </View>
      ) : (
        <TouchableOpacity style={styles.deleteBtn} onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.deleteIcon}>✕</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProjectsScreen() {
  const { projects, removeProject } = useProjects();
  const navigation = useNavigation();
  const c = useThemeColors();
  const [sessionMap, setSessionMap] = useState<Record<string, boolean>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isSelectionMode = selectedIds.size > 0;
  const isSelectionModeRef = useRef(isSelectionMode);
  isSelectionModeRef.current = isSelectionMode;

  // Check which projects have active sessions
  useEffect(() => {
    Promise.all(
      projects.map(async p => {
        const session = await loadSession(p.videoUri);
        return [p.id, !!(session && (session.splitPoints.length > 0 || session.deletedSegments.length > 0 || session.subtitleSegments))] as [string, boolean];
      }),
    ).then(entries => setSessionMap(Object.fromEntries(entries)));
  }, [projects]);

  // Hardware back exits selection mode
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isSelectionModeRef.current) {
        setSelectedIds(new Set());
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  const handleLongPress = useCallback((project: Project) => {
    setSelectedIds(prev => new Set([...prev, project.id]));
  }, []);

  const handleToggleSelect = useCallback((project: Project) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(project.id)) next.delete(project.id);
      else next.add(project.id);
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(() => {
    const count = selectedIds.size;
    Alert.alert(
      'Delete Projects',
      `Delete ${count} project${count !== 1 ? 's' : ''}? Edit progress will be lost.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            selectedIds.forEach(id => removeProject(id));
            setSelectedIds(new Set());
          },
        },
      ],
    );
  }, [selectedIds, removeProject]);

  const handleOpen = useCallback((project: Project) => {
    const ad = RewardedInterstitialAd.createForAdRequest(REWARDED_INTERSTITIAL_AD_UNIT_ID);
    const unsubs: Array<() => void> = [];
    let rewardEarned = false;
    const cleanup = () => { unsubs.forEach(fn => fn()); unsubs.length = 0; };

    unsubs.push(ad.addAdEventListener(RewardedAdEventType.LOADED, () => ad.show()));
    unsubs.push(ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => { rewardEarned = true; }));
    unsubs.push(ad.addAdEventListener(AdEventType.CLOSED, () => {
      cleanup();
      if (rewardEarned) {
        (navigation as any).navigate('Trim', {
          videoUri: project.videoUri,
          duration: project.duration,
        });
      }
    }));
    unsubs.push(ad.addAdEventListener(AdEventType.ERROR, () => { cleanup(); }));

    ad.load();
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
      isSelectionMode={isSelectionMode}
      isSelected={selectedIds.has(item.id)}
      onOpen={() => handleOpen(item)}
      onDelete={() => handleDelete(item)}
      onLongPress={() => handleLongPress(item)}
      onToggleSelect={() => handleToggleSelect(item)}
    />
  ), [sessionMap, isSelectionMode, selectedIds, handleOpen, handleDelete, handleLongPress, handleToggleSelect]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]} edges={['top']}>
      {isSelectionMode ? (
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <TouchableOpacity style={styles.cancelSelBtn} onPress={() => setSelectedIds(new Set())}>
            <Text style={styles.cancelSelText}>✕</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: c.text }]}>{selectedIds.size} selected</Text>
          <TouchableOpacity style={styles.deleteSelBtn} onPress={handleBulkDelete}>
            <Text style={styles.deleteSelText}>Delete</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <Text style={[styles.title, { color: c.text }]}>Projects</Text>
          <TouchableOpacity
            style={styles.newBtn}
            onPress={() => (navigation as any).navigate('Downloads')}
          >
            <Text style={styles.newBtnText}>+ New</Text>
          </TouchableOpacity>
        </View>
      )}

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
      <AdBanner />
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

  list: { padding: 12, gap: 10, paddingBottom: 60 },

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

  // Selection mode
  cardSelected: { borderWidth: 2, borderColor: '#6c63ff' },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#555',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkboxSelected: { backgroundColor: '#6c63ff', borderColor: '#6c63ff' },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  cancelSelBtn: { padding: 6 },
  cancelSelText: { color: '#aaa', fontSize: 16, fontWeight: '700' },
  deleteSelBtn: {
    backgroundColor: '#ff3b30',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  deleteSelText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
