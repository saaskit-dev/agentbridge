import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as React from 'react';
import { View, ScrollView, Pressable, Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import { useUnistyles } from 'react-native-unistyles';
import { appMemorySink } from '@/appTelemetry';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { Text } from '@/components/StyledText';
import { safeStringify } from '@saaskit-dev/agentbridge/common';
import { Modal } from '@/modal';
import { t } from '@/text';

type TimeRange = 'all' | '24h' | '1h';

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '24h', label: 'Last 24h' },
  { value: '1h', label: 'Last 1h' },
];

function getSinceIso(range: TimeRange): string | undefined {
  const now = Date.now();
  if (range === '24h') return new Date(now - 24 * 60 * 60 * 1000).toISOString();
  if (range === '1h') return new Date(now - 60 * 60 * 1000).toISOString();
  return undefined;
}

export default function DiagnosticsScreen() {
  const { theme } = useUnistyles();
  const [timeRange, setTimeRange] = React.useState<TimeRange>('all');
  const [isSharing, setIsSharing] = React.useState(false);

  const entries = React.useMemo(() => {
    const since = getSinceIso(timeRange);
    if (since) {
      return appMemorySink.query({ since });
    }
    return appMemorySink.getEntries();
  }, [timeRange]);

  const sessionCount = React.useMemo(() => {
    const sessions = new Set(entries.map(e => e.sessionId).filter(Boolean));
    return sessions.size;
  }, [entries]);

  const handleShare = async () => {
    if (entries.length === 0) {
      Modal.alert(t('diagnostics.noLogs'), t('diagnostics.noLogsMessage'));
      return;
    }

    setIsSharing(true);
    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const jsonl = entries.map(e => JSON.stringify(e)).join('\n');
      const filename = `diagnostic-${ts}.jsonl`;

      if (Platform.OS === 'web') {
        await Clipboard.setStringAsync(jsonl);
        Modal.alert(t('diagnostics.exported'), t('diagnostics.copiedToClipboard', { count: entries.length }));
        return;
      }

      const file = new File(Paths.cache, filename);
      file.write(jsonl);

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/x-ndjson', UTI: 'public.text' });
      } else {
        Modal.alert(t('diagnostics.exported'), `Saved to: ${file.uri}`);
      }
    } catch (err: unknown) {
      Modal.alert(t('diagnostics.exportFailed'), safeStringify(err));
    } finally {
      setIsSharing(false);
    }
  };

  const handleCopy = async () => {
    if (entries.length === 0) {
      Modal.alert(t('diagnostics.noLogs'), t('diagnostics.noLogsMessage'));
      return;
    }

    const jsonl = entries.map(e => JSON.stringify(e)).join('\n');
    await Clipboard.setStringAsync(jsonl);
    Modal.alert(t('diagnostics.copied'), t('diagnostics.copiedToClipboard', { count: entries.length }));
  };

  const chipStyle = (active: boolean) => ({
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: active ? theme.colors.button.primary.background : theme.colors.surface,
    marginRight: 8,
    borderWidth: 1,
    borderColor: active ? theme.colors.button.primary.background : theme.colors.divider,
  });

  const chipTextStyle = (active: boolean) => ({
    fontSize: 13,
    fontWeight: '500' as const,
    color: active ? theme.colors.button.primary.tint : theme.colors.textSecondary,
  });

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
      <ItemList style={{ paddingTop: 0 }}>
        {/* Preview */}
        <ItemGroup title={t('diagnostics.preview')}>
          <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <Ionicons name="document-text-outline" size={32} color="#007AFF" style={{ marginRight: 12 }} />
              <View>
                <Text style={{ fontSize: 22, fontWeight: '700', color: theme.colors.text }}>
                  {entries.length.toLocaleString()}
                </Text>
                <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                  {t('diagnostics.entriesCount', { count: entries.length, sessions: sessionCount })}
                </Text>
              </View>
            </View>

            {/* Time range selector */}
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginBottom: 8, textTransform: 'uppercase' }}>
              {t('diagnostics.timeRange')}
            </Text>
            <View style={{ flexDirection: 'row' }}>
              {TIME_RANGE_OPTIONS.map(opt => (
                <Pressable
                  key={opt.value}
                  style={chipStyle(timeRange === opt.value)}
                  onPress={() => setTimeRange(opt.value)}
                >
                  <Text style={chipTextStyle(timeRange === opt.value)}>{opt.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </ItemGroup>

        {/* Actions */}
        <ItemGroup title={t('diagnostics.export')}>
          <Item
            title={t('diagnostics.share')}
            subtitle={t('diagnostics.shareSubtitle')}
            icon={<Ionicons name="share-outline" size={24} color="#34C759" />}
            onPress={handleShare}
            loading={isSharing}
            disabled={entries.length === 0 || isSharing}
            showChevron={false}
          />
          <Item
            title={t('diagnostics.copyToClipboard')}
            subtitle={t('diagnostics.copySubtitle')}
            icon={<Ionicons name="copy-outline" size={24} color="#007AFF" />}
            onPress={handleCopy}
            disabled={entries.length === 0}
            showChevron={false}
          />
        </ItemGroup>

        {/* Info */}
        <ItemGroup footer={t('diagnostics.privacyNote')}>
          <Item
            title={t('diagnostics.whatIsIncluded')}
            subtitle={t('diagnostics.whatIsIncludedSubtitle')}
            icon={<Ionicons name="information-circle-outline" size={24} color={theme.colors.textSecondary} />}
            showChevron={false}
          />
        </ItemGroup>
      </ItemList>
    </ScrollView>
  );
}
