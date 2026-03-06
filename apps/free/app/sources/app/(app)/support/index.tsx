import { Stack, useRouter } from 'expo-router';
import * as React from 'react';
import { View, ScrollView, Pressable, Platform } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useEntitlement } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { trackPaywallButtonClicked } from '@/track';
import { Modal } from '@/modal';
import { Text } from '@/components/StyledText';
import { config } from '@/config';

const TIERS = [
  {
    id: 'coffee_monthly',
    name: '咖啡伙伴',
    price: '¥12',
    period: '/月',
    description: '一杯咖啡，让开发更有动力',
    features: ['应用内无赞助标识', '优先获得新功能体验'],
  },
  {
    id: 'builder_monthly',
    name: '共建者',
    price: '¥38',
    period: '/月',
    description: '与我们一起塑造未来的编程方式',
    features: ['所有咖啡伙伴权益', '专属 Discord 频道', '每月一对一答疑'],
    recommended: true,
  },
  {
    id: 'pioneer_monthly',
    name: '先行者',
    price: '¥98',
    period: '/月',
    description: '为先锋而生的专属体验',
    features: ['所有共建者权益', '提前体验实验性功能', '定制化需求优先实现', '专属技术咨询'],
  },
];

export default function SupportScreen() {
  const { theme } = useUnistyles();
  const router = useRouter();
  const isPro = useEntitlement('pro');
  const [selectedId, setSelectedId] = React.useState('builder_monthly');
  const [isPurchasing, setIsPurchasing] = React.useState(false);

  const selectedTier = TIERS.find(t => t.id === selectedId)!;
  const btnBg = theme.colors.button.primary.background;
  const btnText = theme.colors.button.primary.tint;
  const accent = '#4F46E5';

  const handlePurchase = async () => {
    if (isPurchasing) return;
    trackPaywallButtonClicked();
    setIsPurchasing(true);
    try {
      const result = await sync.purchaseProduct(selectedTier.id);
      if (result.success) {
        Modal.alert('感谢支持', `您已成为「${selectedTier.name}」，感谢您的支持！`);
      } else if (result.error && !result.error.includes('cancelled') && !result.error.includes('取消')) {
        Modal.alert('购买失败', result.error);
      }
    } catch (error: any) {
      Modal.alert('购买失败', error?.message || '未知错误，请重试');
    } finally {
      setIsPurchasing(false);
    }
  };

  if (isPro) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <Stack.Screen options={{ title: '赞赏', headerShown: true }} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Ionicons name="checkmark-circle" size={64} color="#34C759" />
          <Text style={{ fontSize: 22, fontWeight: '700', color: theme.colors.text, marginTop: 20, marginBottom: 8 }}>
            感谢您的支持
          </Text>
          <Text style={{ fontSize: 15, color: theme.colors.textSecondary, textAlign: 'center', lineHeight: 22 }}>
            您是尊贵的共建者，正是因为有您的支持，我们才能持续创新。
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack.Screen options={{ title: '赞赏', headerShown: true }} />

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
        <View style={{ marginBottom: 24 }}>
          <Text style={{ fontSize: 22, fontWeight: '700', color: theme.colors.text, marginBottom: 6 }}>
            支持开发
          </Text>
          <Text style={{ fontSize: 14, color: theme.colors.textSecondary, lineHeight: 20 }}>
            您的支持是我们持续创新的动力。选择一个适合您的方式，与我们一起塑造编程的未来。
          </Text>
        </View>

        <View style={{ gap: 10, marginBottom: 24 }}>
          {TIERS.map(tier => {
            const isSelected = tier.id === selectedId;
            return (
              <Pressable
                key={tier.id}
                onPress={() => setSelectedId(tier.id)}
                style={{
                  borderRadius: 12,
                  borderWidth: 1.5,
                  borderColor: isSelected ? accent : theme.colors.divider,
                  backgroundColor: theme.colors.surface,
                  padding: 16,
                }}
              >
                {tier.recommended && (
                  <View style={{
                    alignSelf: 'flex-start',
                    backgroundColor: accent,
                    borderRadius: 4,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    marginBottom: 10,
                  }}>
                    <Text style={{ fontSize: 11, fontWeight: '600', color: '#fff' }}>推荐</Text>
                  </View>
                )}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.text, marginBottom: 3 }}>
                      {tier.name}
                    </Text>
                    <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>
                      {tier.description}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', marginLeft: 16 }}>
                    <Text style={{ fontSize: 22, fontWeight: '700', color: theme.colors.text }}>
                      {tier.price}
                    </Text>
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>{tier.period}</Text>
                  </View>
                </View>
                <View style={{ marginTop: 12, gap: 5 }}>
                  {tier.features.map((f, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons name="checkmark" size={13} color={isSelected ? accent : theme.colors.textSecondary} />
                      <Text style={{ fontSize: 13, color: theme.colors.textSecondary }}>{f}</Text>
                    </View>
                  ))}
                </View>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={handlePurchase}
          disabled={isPurchasing}
          style={({ pressed }) => ({
            height: 50,
            borderRadius: 12,
            backgroundColor: btnBg,
            justifyContent: 'center',
            alignItems: 'center',
            opacity: isPurchasing ? 0.6 : pressed ? 0.85 : 1,
          })}
        >
          <Text style={{ fontSize: 16, fontWeight: '600', color: btnText }}>
            {isPurchasing ? '处理中...' : `加入 ${selectedTier.name} · ${selectedTier.price}${selectedTier.period}`}
          </Text>
        </Pressable>

        <Text style={{ fontSize: 12, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 10 }}>
          可随时取消 · 安全支付
        </Text>

        {__DEV__ && (
          <View style={{ marginTop: 32, padding: 14, backgroundColor: theme.colors.surface, borderRadius: 10 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: theme.colors.textSecondary, marginBottom: 8 }}>
              开发诊断
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginBottom: 2 }}>
              平台: {Platform.OS}
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginBottom: 2 }}>
              Stripe Key: {config.revenueCatStripeKey ? `✅ ${config.revenueCatStripeKey.slice(0, 12)}...` : '❌ 未设置'}
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginBottom: 8 }}>
              RevenueCat: {sync.revenueCatInitialized ? '✅ 已初始化' : '❌ 未初始化'}
            </Text>
            <Pressable
              onPress={async () => {
                try {
                  await sync.purchasesSync.invalidateAndAwait();
                  Modal.alert('诊断', sync.revenueCatInitialized ? '✅ 初始化成功' : '❌ 初始化失败，请查看控制台');
                } catch (e: any) {
                  Modal.alert('诊断错误', e?.message || String(e));
                }
              }}
              style={{ paddingVertical: 6, paddingHorizontal: 12, backgroundColor: btnBg, borderRadius: 6, alignSelf: 'flex-start' }}
            >
              <Text style={{ fontSize: 11, color: btnText, fontWeight: '600' }}>手动触发初始化</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
