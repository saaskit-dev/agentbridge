import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as React from 'react';
import { View, Text, FlatList, Pressable, ScrollView, Platform } from 'react-native';
import type { LogEntry, Level } from '@saaskit-dev/agentbridge/telemetry';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { appMemorySink } from '@/appTelemetry';
import { Modal } from '@/modal';

const LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];

const LEVEL_COLORS: Record<Level, string> = {
  debug: '#999',
  info: '#333',
  warn: '#CC7700',
  error: '#CC0000',
};

function formatEntry(entry: LogEntry): string {
  const ts = new Date(entry.timestamp).toISOString().substring(11, 23);
  const tracePrefix = entry.traceId ? ` [${entry.traceId.slice(0, 8)}]` : '';
  return `[${ts}] [${entry.level.toUpperCase()}] [${entry.component}]${tracePrefix} ${entry.message}`;
}

export default function LogsScreen() {
  const [allEntries, setAllEntries] = React.useState<LogEntry[]>(() => appMemorySink.getEntries());
  const [levelFilter, setLevelFilter] = React.useState<Level | null>(null);
  const [componentFilter, setComponentFilter] = React.useState<string | null>(null);
  const flatListRef = React.useRef<FlatList>(null);

  React.useEffect(() => {
    const unsubscribe = appMemorySink.onChange(() => {
      setAllEntries(appMemorySink.getEntries());
    });
    return unsubscribe;
  }, []);

  const entries = React.useMemo(() => {
    if (!levelFilter && !componentFilter) return allEntries;
    return appMemorySink.query({
      ...(levelFilter ? { level: levelFilter } : {}),
      ...(componentFilter ? { component: componentFilter } : {}),
    });
  }, [allEntries, levelFilter, componentFilter]);

  // Auto-scroll to bottom when new entries arrive (only when no filter active)
  React.useEffect(() => {
    if (entries.length > 0 && !levelFilter && !componentFilter) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
      }, 100);
    }
  }, [entries.length, levelFilter, componentFilter]);

  const components = React.useMemo(() => {
    const set = new Set(allEntries.map(e => e.component));
    return Array.from(set).sort();
  }, [allEntries]);

  const handleClear = async () => {
    const confirmed = await Modal.confirm(
      'Clear Logs',
      'Are you sure you want to clear all logs?',
      { confirmText: 'Clear', destructive: true }
    );
    if (confirmed) {
      appMemorySink.clear();
      setAllEntries([]);
      setLevelFilter(null);
      setComponentFilter(null);
    }
  };

  const handleCopyAll = async () => {
    if (entries.length === 0) {
      Modal.alert('No Logs', 'There are no logs to copy');
      return;
    }

    const allLogs = entries.map(formatEntry).join('\n');
    await Clipboard.setStringAsync(allLogs);
    Modal.alert('Copied', `${entries.length} log entries copied to clipboard`);
  };

  const handleExport = async () => {
    const exportEntries = allEntries;
    if (exportEntries.length === 0) {
      Modal.alert('No Logs', 'There are no logs to export');
      return;
    }

    try {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const jsonl = exportEntries.map(e => JSON.stringify(e)).join('\n');
      const filename = `diagnostic-${ts}.jsonl`;

      if (Platform.OS === 'web') {
        // Web: copy to clipboard as fallback
        await Clipboard.setStringAsync(jsonl);
        Modal.alert('Exported', `${exportEntries.length} entries copied to clipboard as JSONL`);
        return;
      }

      const file = new File(Paths.cache, filename);
      file.write(jsonl);

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(file.uri, { mimeType: 'application/x-ndjson', UTI: 'public.text' });
      } else {
        Modal.alert('Exported', `Saved to: ${file.uri}`);
      }
    } catch (err: unknown) {
      Modal.alert('Export Failed', err instanceof Error ? err.message : String(err));
    }
  };

  const renderLogItem = ({ item }: { item: LogEntry }) => (
    <View
      style={{
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
      }}
    >
      <Text
        style={{
          fontFamily: 'IBMPlexMono-Regular',
          fontSize: 12,
          color: LEVEL_COLORS[item.level] ?? '#333',
          lineHeight: 16,
        }}
      >
        {formatEntry(item)}
      </Text>
    </View>
  );

  const filterChipStyle = (active: boolean) => ({
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: active ? '#007AFF' : '#E5E5EA',
    marginRight: 6,
  });

  const filterChipTextStyle = (active: boolean) => ({
    fontSize: 12,
    color: active ? '#FFFFFF' : '#333333',
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      {/* Header with actions */}
      <ItemList>
        <ItemGroup title={`Logs (${entries.length}${levelFilter || componentFilter ? ' filtered' : ''})`}>
          <Item
            title="Export Diagnostic Bundle"
            subtitle={`${allEntries.length} entries`}
            icon={<Ionicons name="share-outline" size={24} color="#34C759" />}
            onPress={handleExport}
            disabled={allEntries.length === 0}
          />
          <Item
            title="Copy All Logs"
            icon={<Ionicons name="copy-outline" size={24} color="#007AFF" />}
            onPress={handleCopyAll}
            disabled={entries.length === 0}
          />
          <Item
            title="Clear All Logs"
            icon={<Ionicons name="trash-outline" size={24} color="#FF3B30" />}
            onPress={handleClear}
            disabled={allEntries.length === 0}
            destructive={true}
          />
        </ItemGroup>
      </ItemList>

      {/* Level filter chips */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
        <Text style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>LEVEL</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Pressable style={filterChipStyle(levelFilter === null)} onPress={() => setLevelFilter(null)}>
            <Text style={filterChipTextStyle(levelFilter === null)}>All</Text>
          </Pressable>
          {LEVELS.map(level => (
            <Pressable
              key={level}
              style={filterChipStyle(levelFilter === level)}
              onPress={() => setLevelFilter(levelFilter === level ? null : level)}
            >
              <Text style={filterChipTextStyle(levelFilter === level)}>{level.toUpperCase()}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Component filter chips */}
      {components.length > 0 && (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <Text style={{ fontSize: 11, color: '#666', marginBottom: 6 }}>COMPONENT</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Pressable style={filterChipStyle(componentFilter === null)} onPress={() => setComponentFilter(null)}>
              <Text style={filterChipTextStyle(componentFilter === null)}>All</Text>
            </Pressable>
            {components.map(comp => (
              <Pressable
                key={comp}
                style={filterChipStyle(componentFilter === comp)}
                onPress={() => setComponentFilter(componentFilter === comp ? null : comp)}
              >
                <Text style={filterChipTextStyle(componentFilter === comp)}>{comp}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Logs display */}
      <View style={{ flex: 1, backgroundColor: '#FFFFFF', marginHorizontal: 16, marginBottom: 16, borderRadius: 8 }}>
        {entries.length === 0 ? (
          <View
            style={{
              flex: 1,
              justifyContent: 'center',
              alignItems: 'center',
              padding: 32,
            }}
          >
            <Ionicons name="document-text-outline" size={48} color="#C0C0C0" />
            <Text
              style={{
                fontSize: 16,
                color: '#999',
                marginTop: 16,
                textAlign: 'center',
              }}
            >
              {levelFilter || componentFilter ? 'No matching logs' : 'No logs yet'}
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: '#C0C0C0',
                marginTop: 8,
                textAlign: 'center',
              }}
            >
              {levelFilter || componentFilter
                ? 'Try adjusting the filters above'
                : 'Logs will appear here as they are generated'}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={entries}
            renderItem={renderLogItem}
            keyExtractor={(item, index) => `${item.timestamp}-${index}`}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingVertical: 8 }}
            showsVerticalScrollIndicator={true}
          />
        )}
      </View>
    </View>
  );
}
