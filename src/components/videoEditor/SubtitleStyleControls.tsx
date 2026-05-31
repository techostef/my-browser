import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  ScrollView,
  Platform,
} from 'react-native';
import type {
  SubtitleStyle,
  SubtitleFontFamily,
  SubtitleFontSize,
} from '../../types/videoEditor';
import { SUBTITLE_FONT_SCALE } from '../../types/videoEditor';
import { useTranslation } from '../../i18n';

type Props = {
  value: SubtitleStyle;
  onChange: (next: SubtitleStyle) => void;
};

const BG_COLORS: { hex: string; label: string }[] = [
  { hex: '#000000', label: 'Black' },
  { hex: '#FFFFFF', label: 'White' },
  { hex: '#FFD400', label: 'Yellow' },
  { hex: '#E53935', label: 'Red' },
  { hex: '#1E88E5', label: 'Blue' },
];

const TEXT_COLORS: { hex: string; label: string }[] = [
  { hex: '#FFFFFF', label: 'White' },
  { hex: '#000000', label: 'Black' },
  { hex: '#FFD400', label: 'Yellow' },
  { hex: '#E53935', label: 'Red' },
  { hex: '#1E88E5', label: 'Blue' },
  { hex: '#43A047', label: 'Green' },
];

const FONT_OPTIONS: { id: SubtitleFontFamily; label: string }[] = [
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Mono' },
];

const SIZE_OPTIONS: { id: SubtitleFontSize; label: string }[] = [
  { id: 'sm', label: 'S' },
  { id: 'md', label: 'M' },
  { id: 'lg', label: 'L' },
  { id: 'xl', label: 'XL' },
];

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbaFromStyle(style: SubtitleStyle): string {
  const { r, g, b } = hexToRgb(style.color);
  return `rgba(${r},${g},${b},${style.opacity})`;
}

export function resolveFontFamily(family: SubtitleFontFamily): string | undefined {
  if (family === 'serif') {
    return Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' });
  }
  if (family === 'mono') {
    return Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
  }
  return undefined; // system default sans
}

export default function SubtitleStyleControls({ value, onChange }: Props) {
  const { t } = useTranslation();
  const trackRef = useRef<View | null>(null);
  const trackPageXRef = useRef(0);
  const trackWRef = useRef(0);
  const valueRef = useRef(value);
  valueRef.current = value;

  const measureTrack = () => {
    trackRef.current?.measureInWindow((x, _y, w) => {
      trackPageXRef.current = x;
      trackWRef.current = w;
    });
  };

  const setOpacityFromPageX = (pageX: number) => {
    const w = trackWRef.current;
    if (w <= 0) return;
    const local = pageX - trackPageXRef.current;
    const clamped = Math.max(0, Math.min(1, local / w));
    const stepped = Math.round(clamped * 20) / 20;
    if (stepped === valueRef.current.opacity) return;
    onChange({ ...valueRef.current, opacity: stepped });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const pageX = e.nativeEvent.pageX;
        measureTrack();
        // measureInWindow is async on some platforms; defer one frame so the
        // first tap lands using fresh measurements. Capture pageX up front
        // because the synthetic event is pooled and nullified by then.
        requestAnimationFrame(() => setOpacityFromPageX(pageX));
      },
      onPanResponderMove: (e) => setOpacityFromPageX(e.nativeEvent.pageX),
    }),
  ).current;

  const opacityPct = Math.round(value.opacity * 100);
  const sliderFillPct = `${opacityPct}%` as const;
  const previewBg = rgbaFromStyle(value);
  const previewFontSize = Math.round(20 * SUBTITLE_FONT_SCALE[value.fontSize]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.rootContent}>
      {/* Preview */}
      <View style={styles.previewWrap}>
        <View style={[styles.previewBox, { backgroundColor: previewBg }]}>
          <Text
            style={{
              color: value.textColor,
              fontSize: previewFontSize,
              fontWeight: '700',
              fontFamily: resolveFontFamily(value.fontFamily),
              textShadowColor: 'rgba(0,0,0,0.85)',
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 3,
            }}
          >
            {t('sampleSubtitle')}
          </Text>
        </View>
      </View>

      {/* Font family */}
      <Text style={styles.sectionTitle}>{t('subtitleFont')}</Text>
      <View style={styles.chipRow}>
        {FONT_OPTIONS.map((f) => {
          const selected = f.id === value.fontFamily;
          return (
            <TouchableOpacity
              key={f.id}
              onPress={() => onChange({ ...value, fontFamily: f.id })}
              style={[styles.pill, selected && styles.pillSelected]}
            >
              <Text
                style={[
                  styles.pillText,
                  selected && styles.pillTextSelected,
                  { fontFamily: resolveFontFamily(f.id) },
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Font size */}
      <Text style={styles.sectionTitle}>{t('subtitleSize')}</Text>
      <View style={styles.chipRow}>
        {SIZE_OPTIONS.map((s) => {
          const selected = s.id === value.fontSize;
          return (
            <TouchableOpacity
              key={s.id}
              onPress={() => onChange({ ...value, fontSize: s.id })}
              style={[styles.sizePill, selected && styles.pillSelected]}
            >
              <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                {s.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Text color */}
      <Text style={styles.sectionTitle}>{t('textColor')}</Text>
      <View style={styles.chipRow}>
        {TEXT_COLORS.map((c) => {
          const selected = c.hex.toUpperCase() === (value.textColor ?? '').toUpperCase();
          return (
            <TouchableOpacity
              key={c.hex}
              onPress={() => onChange({ ...value, textColor: c.hex })}
              style={[styles.colorChipWrap, selected && styles.colorChipWrapSelected]}
              accessibilityLabel={`Text color ${c.label}`}
            >
              <View
                style={[
                  styles.colorChip,
                  { backgroundColor: c.hex },
                  c.hex === '#FFFFFF' && styles.colorChipLight,
                ]}
              />
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Background color */}
      <Text style={styles.sectionTitle}>{t('background')}</Text>
      <View style={styles.chipRow}>
        {BG_COLORS.map((c) => {
          const selected = c.hex.toUpperCase() === (value.color ?? '').toUpperCase();
          return (
            <TouchableOpacity
              key={c.hex}
              onPress={() => onChange({ ...value, color: c.hex })}
              style={[styles.colorChipWrap, selected && styles.colorChipWrapSelected]}
              accessibilityLabel={`Background color ${c.label}`}
            >
              <View
                style={[
                  styles.colorChip,
                  { backgroundColor: c.hex },
                  c.hex === '#FFFFFF' && styles.colorChipLight,
                ]}
              />
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.sliderRow}>
        <Text style={styles.sliderLabel}>{t('opacity')}</Text>
        <Text style={styles.sliderValue}>
          {value.opacity === 0 ? t('off') : `${opacityPct}%`}
        </Text>
      </View>
      <View
        ref={trackRef}
        style={styles.sliderHit}
        onLayout={measureTrack}
        {...panResponder.panHandlers}
      >
        <View style={styles.sliderTrack}>
          <View style={[styles.sliderFill, { width: sliderFillPct }]} />
          <View style={[styles.sliderThumb, { left: sliderFillPct }]} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flexGrow: 0,
  },
  rootContent: {
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  previewWrap: {
    alignItems: 'center',
    paddingTop: 18,
    paddingBottom: 8,
  },
  previewBox: {
    minWidth: 200,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
  },
  sectionTitle: {
    color: '#bdbdc7',
    fontSize: 12,
    fontWeight: '600',
    paddingTop: 16,
    paddingBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#2a2a35',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sizePill: {
    minWidth: 44,
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#2a2a35',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  pillSelected: {
    backgroundColor: '#6c63ff',
    borderColor: '#8d86ff',
  },
  pillText: {
    color: '#d6d6dc',
    fontSize: 14,
    fontWeight: '600',
  },
  pillTextSelected: {
    color: '#fff',
  },
  colorChipWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorChipWrapSelected: {
    borderColor: '#8d86ff',
  },
  colorChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  colorChipLight: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#777',
  },
  sliderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 6,
  },
  sliderLabel: {
    color: '#d6d6dc',
    fontSize: 13,
    fontWeight: '500',
  },
  sliderValue: {
    color: '#bdbdc7',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  sliderHit: {
    paddingVertical: 12,
  },
  sliderTrack: {
    height: 4,
    backgroundColor: '#3a3a4a',
    borderRadius: 2,
    position: 'relative',
  },
  sliderFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#6c63ff',
    borderRadius: 2,
  },
  sliderThumb: {
    position: 'absolute',
    top: -8,
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 10,
    backgroundColor: '#6c63ff',
    borderWidth: 2,
    borderColor: '#fff',
  },
});
