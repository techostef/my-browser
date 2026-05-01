import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { BrowserTab } from '../types';

interface Props {
  tabs: BrowserTab[];
  activeTabId: string;
  onSwitchTab: (id: string) => void;
  onAddTab: () => void;
  onRemoveTab: (id: string) => void;
}

export default function TabBar({
  tabs,
  activeTabId,
  onSwitchTab,
  onAddTab,
  onRemoveTab,
}: Props) {
  const visibleTabs = tabs.filter(t => !t.hidden);
  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}>
        {visibleTabs.map(tab => {
          const isActive = tab.id === activeTabId;
          return (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, isActive && styles.activeTab]}
              onPress={() => onSwitchTab(tab.id)}
              activeOpacity={0.7}>
              <Text
                style={[styles.tabText, isActive && styles.activeTabText]}
                numberOfLines={1}
                ellipsizeMode="tail">
                {tab.title || 'New Tab'}
              </Text>
              {visibleTabs.length > 1 && (
                <TouchableOpacity
                  style={styles.closeBtn}
                  onPress={() => onRemoveTab(tab.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={[styles.closeBtnText, isActive && styles.activeCloseBtnText]}>
                    ×
                  </Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <TouchableOpacity style={styles.addBtn} onPress={onAddTab}>
        <Text style={styles.addBtnText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8E8E8',
    paddingVertical: 4,
    paddingLeft: 4,
  },
  scrollContent: {
    alignItems: 'center',
    paddingRight: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D0D0D0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 4,
    maxWidth: 160,
  },
  activeTab: {
    backgroundColor: '#FFF',
  },
  tabText: {
    fontSize: 12,
    color: '#666',
    flexShrink: 1,
    maxWidth: 110,
  },
  activeTabText: {
    color: '#333',
    fontWeight: '600',
  },
  closeBtn: {
    marginLeft: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 14,
    lineHeight: 16,
    color: '#888',
    fontWeight: '600',
  },
  activeCloseBtnText: {
    color: '#555',
  },
  addBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#D0D0D0',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  addBtnText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#555',
    lineHeight: 20,
  },
});
