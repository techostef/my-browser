import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSettings } from '../store/settingsStore';

const HISTORY_KEY = '@search_history_v1';
const MAX_HISTORY = 50;

interface Props {
  initialUrl: string;
  onNavigate: (url: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
}

export default function AddressBar({
  initialUrl,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  canGoBack,
  canGoForward,
  loading,
  isBookmarked,
  onToggleBookmark,
}: Props) {
  const { searchUrl, themeColors: c } = useSettings();
  const displayUrl = initialUrl === 'about:home' ? '' : initialUrl;
  const [text, setText] = useState(displayUrl);
  const [history, setHistory] = useState<string[]>([]);
  const [focused, setFocused] = useState(false);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setText(initialUrl === 'about:home' ? '' : initialUrl);
  }, [initialUrl]);

  // Load history on mount
  useEffect(() => {
    AsyncStorage.getItem(HISTORY_KEY).then((raw) => {
      if (raw) setHistory(JSON.parse(raw));
    });
  }, []);

  const saveToHistory = useCallback((entry: string) => {
    setHistory((prev) => {
      const filtered = prev.filter((h) => h !== entry);
      const next = [entry, ...filtered].slice(0, MAX_HISTORY);
      AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const filteredHistory = focused
    ? (text.trim()
        ? history.filter((h) => h.toLowerCase().includes(text.toLowerCase()))
        : history
      ).slice(0, 10)
    : [];

  const handleSubmit = () => {
    let url = text.trim();
    if (!url) return;

    saveToHistory(url);

    if (!/^https?:\/\//i.test(url)) {
      if (/^[\w-]+(\.[\w-]+)+/.test(url)) {
        url = 'https://' + url;
      } else {
        url = searchUrl(url);
      }
    }
    setText(url);
    setFocused(false);
    onNavigate(url);
  };

  const handlePickHistory = (item: string) => {
    setText(item);
    setFocused(false);
    // Trigger navigation with the picked item
    let url = item.trim();
    if (!/^https?:\/\//i.test(url)) {
      if (/^[\w-]+(\.[\w-]+)+/.test(url)) {
        url = 'https://' + url;
      } else {
        url = searchUrl(url);
      }
    }
    onNavigate(url);
  };

  const handleDeleteHistory = useCallback((item: string) => {
    setHistory((prev) => {
      const next = prev.filter((h) => h !== item);
      AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: c.addressBar, borderBottomColor: c.border }]}>
      <View style={styles.navButtons}>
        <TouchableOpacity
          onPress={onGoBack}
          disabled={!canGoBack}
          style={[styles.navBtn, { backgroundColor: c.navButton }, !canGoBack && styles.navBtnDisabled]}>
          <Text style={[styles.navBtnText, { color: c.text }]}>{'<'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onGoForward}
          disabled={!canGoForward}
          style={[styles.navBtn, { backgroundColor: c.navButton }, !canGoForward && styles.navBtnDisabled]}>
          <Text style={[styles.navBtnText, { color: c.text }]}>{'>'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.inputWrapper}>
        <TextInput
          style={[styles.input, { backgroundColor: c.inputBackground, borderColor: c.inputBorder, color: c.text }]}
          value={text}
          onChangeText={setText}
          onSubmitEditing={handleSubmit}
          onFocus={() => {
            if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
            setFocused(true);
          }}
          onBlur={() => {
            blurTimeoutRef.current = setTimeout(() => setFocused(false), 200);
          }}
          placeholder="Enter URL or search..."
          placeholderTextColor={c.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          selectTextOnFocus
        />
        {filteredHistory.length > 0 && (
          <View style={[styles.dropdown, { backgroundColor: c.inputBackground, borderColor: c.inputBorder }]}>
            <FlatList
              data={filteredHistory}
              keyExtractor={(item, idx) => `${item}_${idx}`}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <View style={styles.historyRow}>
                  <TouchableOpacity
                    style={styles.historyItem}
                    onPress={() => handlePickHistory(item)}
                  >
                    <Text style={[styles.historyText, { color: c.text }]} numberOfLines={1}>{item}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.historyDelete}
                    onPress={() => handleDeleteHistory(item)}
                  >
                    <Text style={styles.historyDeleteText}>✕</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          </View>
        )}
      </View>

      <TouchableOpacity onPress={onReload} style={[styles.navBtn, { backgroundColor: c.navButton }]}>
        {loading ? (
          <ActivityIndicator size="small" color="#007AFF" />
        ) : (
          <Text style={[styles.navBtnText, { color: c.text }]}>↻</Text>
        )}
      </TouchableOpacity>
      {onToggleBookmark && (
        <TouchableOpacity onPress={onToggleBookmark} style={[styles.navBtn, { backgroundColor: c.navButton }]}>
          <Text style={[styles.navBtnText, { color: isBookmarked ? '#FFD60A' : c.text }]}>
            {isBookmarked ? '★' : '☆'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#F8F8F8',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#CCC',
  },
  navButtons: {
    flexDirection: 'row',
    marginRight: 6,
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#E8E8E8',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 2,
  },
  navBtnDisabled: {
    opacity: 0.35,
  },
  navBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  inputWrapper: {
    flex: 1,
    position: 'relative',
    marginHorizontal: 6,
  },
  input: {
    height: 36,
    borderRadius: 8,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#DDD',
    paddingHorizontal: 10,
    fontSize: 14,
    color: '#333',
  },
  dropdown: {
    position: 'absolute',
    top: 38,
    left: 0,
    right: 0,
    maxHeight: 220,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#DDD',
    zIndex: 999,
    elevation: 5,
    overflow: 'hidden',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyItem: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  historyText: {
    fontSize: 13,
  },
  historyDelete: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  historyDeleteText: {
    fontSize: 13,
    color: '#999',
  },
});
