import React from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import DownloadItem from '../components/DownloadItem';
import { useDownloads } from '../store/downloadStore';

export default function DownloadsScreen() {
  const {
    downloads,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    removeDownload,
  } = useDownloads();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Downloads</Text>
        <Text style={styles.headerSubtitle}>
          {downloads.length} item{downloads.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {downloads.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📥</Text>
          <Text style={styles.emptyText}>No downloads yet</Text>
          <Text style={styles.emptySubtext}>
            Browse a page with videos and tap the download button
          </Text>
        </View>
      ) : (
        <FlatList
          data={downloads}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <DownloadItem
              task={item}
              onPause={pauseDownload}
              onResume={resumeDownload}
              onCancel={cancelDownload}
              onRemove={removeDownload}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#DDD',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 2,
  },
  listContent: {
    paddingVertical: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#555',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    lineHeight: 20,
  },
});
