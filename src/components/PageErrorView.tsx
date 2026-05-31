import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useThemeColors } from '../store/settingsStore';
import { useTranslation } from '../i18n';

export interface PageError {
  url: string;
  code?: number;
  description?: string;
  kind: 'network' | 'http';
}

interface Props {
  error: PageError;
  onRetry: () => void;
  onGoBack?: () => void;
  canGoBack?: boolean;
}

interface ErrorMeta {
  title: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
}

type TFn = ReturnType<typeof useTranslation>['t'];

function resolveErrorMeta(error: PageError, accent: string, t: TFn): ErrorMeta {
  if (error.kind === 'http') {
    const code = error.code ?? 0;
    if (code === 404) {
      return {
        title: t('errorPageNotFound'),
        hint: t('errorPageNotFoundHint'),
        icon: 'document-text-outline',
        tint: '#FF9500',
      };
    }
    if (code === 403) {
      return {
        title: t('errorAccessDenied'),
        hint: t('errorAccessDeniedHint'),
        icon: 'lock-closed-outline',
        tint: '#FF3B30',
      };
    }
    if (code >= 500) {
      return {
        title: t('errorServerError'),
        hint: t('errorServerErrorHint'),
        icon: 'server-outline',
        tint: '#FF3B30',
      };
    }
    return {
      title: t('errorCouldntLoad', { code: String(code || 'HTTP error') }),
      hint: t('errorUnexpectedResponse'),
      icon: 'alert-circle-outline',
      tint: '#FF9500',
    };
  }

  const desc = (error.description || '').toLowerCase();
  if (desc.includes('not connected to the internet') || desc.includes('internet_disconnected')) {
    return {
      title: t('errorOffline'),
      hint: t('errorOfflineHint'),
      icon: 'cloud-offline-outline',
      tint: accent,
    };
  }
  if (desc.includes('name_not_resolved') || desc.includes('hostname could not be found') || desc.includes('cannot find host')) {
    return {
      title: t('errorCantReach'),
      hint: t('errorCantReachHint'),
      icon: 'help-circle-outline',
      tint: '#FF9500',
    };
  }
  if (desc.includes('timed out') || desc.includes('timeout')) {
    return {
      title: t('errorTimeout'),
      hint: t('errorTimeoutHint'),
      icon: 'time-outline',
      tint: '#FF9500',
    };
  }
  if (desc.includes('connection_refused') || desc.includes('could not connect')) {
    return {
      title: t('errorConnectionRefused'),
      hint: t('errorConnectionRefusedHint'),
      icon: 'close-circle-outline',
      tint: '#FF3B30',
    };
  }
  if (desc.includes('ssl') || desc.includes('certificate') || desc.includes('cert_')) {
    return {
      title: t('errorNotPrivate'),
      hint: t('errorNotPrivateHint'),
      icon: 'shield-outline',
      tint: '#FF3B30',
    };
  }
  return {
    title: t('errorPageDidntLoad'),
    hint: error.description || t('errorDefaultHint'),
    icon: 'warning-outline',
    tint: '#FF9500',
  };
}

function getDomain(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export default function PageErrorView({ error, onRetry, onGoBack, canGoBack }: Props) {
  const c = useThemeColors();
  const { t } = useTranslation();
  const meta = useMemo(() => resolveErrorMeta(error, '#4ECDC4', t), [error, t]);
  const domain = getDomain(error.url);

  if (error?.description) {
    return null
  }

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
        <View style={[styles.iconWrap, { backgroundColor: meta.tint + '1A' }]}>
          <Ionicons name={meta.icon} size={56} color={meta.tint} />
        </View>

        <Text style={[styles.title, { color: c.text }]}>{meta.title}</Text>
        <Text style={[styles.domain, { color: c.textSecondary }]} numberOfLines={1}>
          {domain}
        </Text>

        <Text style={[styles.hint, { color: c.textSecondary }]}>{meta.hint}</Text>

        {(error.code || error.description) && (
          <View style={[styles.detailsCard, { backgroundColor: c.surfaceSecondary, borderColor: c.border }]}>
            {error.code !== undefined && (
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: c.textSecondary }]}>{t('statusLabel')}</Text>
                <Text style={[styles.detailValue, { color: c.text }]}>{error.code}</Text>
              </View>
            )}
            {error.description ? (
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: c.textSecondary }]}>{t('detailsLabel')}</Text>
                <Text style={[styles.detailValue, { color: c.text }]} numberOfLines={3}>
                  {error.description}
                </Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: '#4ECDC4' }]}
            onPress={onRetry}
            activeOpacity={0.85}>
            <Ionicons name="refresh" size={18} color="#FFFFFF" />
            <Text style={styles.primaryBtnText}>{t('tryAgain')}</Text>
          </TouchableOpacity>

          {canGoBack && onGoBack && (
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: c.border }]}
              onPress={onGoBack}
              activeOpacity={0.85}>
              <Ionicons name="arrow-back" size={18} color={c.text} />
              <Text style={[styles.secondaryBtnText, { color: c.text }]}>{t('goBack')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 40,
  },
  iconWrap: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 6,
  },
  domain: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 16,
    textAlign: 'center',
  },
  hint: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
    maxWidth: 340,
  },
  detailsCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginBottom: 28,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    width: 64,
    paddingTop: 1,
  },
  detailValue: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
