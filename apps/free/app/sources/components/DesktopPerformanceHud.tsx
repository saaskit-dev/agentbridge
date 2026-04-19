import * as React from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { resetPerformanceMetrics, usePerformanceSnapshot } from '@/dev/performanceMonitor';
import { useLocalSetting } from '@/sync/storage';
import { isTauriDesktop } from '@/utils/tauri';

export const DesktopPerformanceHud = React.memo(function DesktopPerformanceHud() {
  const { theme } = useUnistyles();
  const enabled = useLocalSetting('performanceProfilingEnabled');
  const [collapsed, setCollapsed] = React.useState(false);
  const snapshot = usePerformanceSnapshot();

  if (!enabled || Platform.OS !== 'web' || !isTauriDesktop()) {
    return null;
  }

  const metrics = snapshot.metrics.slice(0, collapsed ? 4 : 10);

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 9999,
      }}
    >
      <View
        style={{
          width: 320,
          maxHeight: 360,
          borderRadius: 16,
          backgroundColor: theme.dark ? 'rgba(12, 16, 24, 0.92)' : 'rgba(255,255,255,0.95)',
          borderWidth: 1,
          borderColor: theme.dark ? 'rgba(255,255,255,0.1)' : 'rgba(18, 28, 45, 0.08)',
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            paddingHorizontal: 12,
            paddingVertical: 10,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: '700',
              color: theme.colors.text,
            }}
          >
            Desktop Perf HUD
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => resetPerformanceMetrics()}>
              <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>Reset</Text>
            </Pressable>
            <Pressable onPress={() => setCollapsed(value => !value)}>
              <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>
                {collapsed ? 'Expand' : 'Collapse'}
              </Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={{ maxHeight: 300 }}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12, gap: 8 }}
        >
          {metrics.length === 0 ? (
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary }}>
              Waiting for performance samples…
            </Text>
          ) : (
            metrics.map(metric => (
              <View
                key={metric.name}
                style={{
                  borderRadius: 12,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  backgroundColor: theme.dark ? 'rgba(255,255,255,0.04)' : 'rgba(15, 23, 42, 0.04)',
                }}
              >
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 11, fontWeight: '600', color: theme.colors.text }}
                >
                  {metric.name}
                </Text>
                <Text style={{ fontSize: 10, color: theme.colors.textSecondary, marginTop: 4 }}>
                  last {metric.lastDurationMs.toFixed(2)}ms · avg {metric.avgDurationMs.toFixed(2)}ms · max{' '}
                  {metric.maxDurationMs.toFixed(2)}ms · count {metric.count}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </View>
  );
});
