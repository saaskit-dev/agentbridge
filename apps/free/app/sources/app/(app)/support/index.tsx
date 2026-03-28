import { Stack, useRouter } from 'expo-router';
import * as React from 'react';
import { View, ScrollView, Pressable, Platform } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useEntitlement } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { Modal } from '@/modal';
import { Text } from '@/components/StyledText';
import { safeStringify } from '@saaskit-dev/agentbridge/common';
import { config } from '@/config';
import { t } from '@/text';

function getTiers() {
  return [
    {
      id: 'coffee_monthly',
      name: t('support.tierCoffee'),
      price: t('support.tierCoffeePrice'),
      period: t('support.tierCoffeePeriod'),
      description: t('support.tierCoffeeDescription'),
      features: [t('support.tierCoffeeFeature1'), t('support.tierCoffeeFeature2')],
    },
    {
      id: 'builder_monthly',
      name: t('support.tierBuilder'),
      price: t('support.tierBuilderPrice'),
      period: t('support.tierBuilderPeriod'),
      description: t('support.tierBuilderDescription'),
      features: [
        t('support.tierBuilderFeature1'),
        t('support.tierBuilderFeature2'),
        t('support.tierBuilderFeature3'),
      ],
      recommended: true,
    },
    {
      id: 'pioneer_monthly',
      name: t('support.tierPioneer'),
      price: t('support.tierPioneerPrice'),
      period: t('support.tierPioneerPeriod'),
      description: t('support.tierPioneerDescription'),
      features: [
        t('support.tierPioneerFeature1'),
        t('support.tierPioneerFeature2'),
        t('support.tierPioneerFeature3'),
        t('support.tierPioneerFeature4'),
      ],
    },
  ];
}

export default function SupportScreen() {
  const { theme } = useUnistyles();
  const router = useRouter();
  const isPro = useEntitlement('pro');
  const [selectedId, setSelectedId] = React.useState('builder_monthly');
  const [isPurchasing, setIsPurchasing] = React.useState(false);

  const TIERS = getTiers();
  const selectedTier = TIERS.find(tier => tier.id === selectedId)!;
  const btnBg = theme.colors.button.primary.background;
  const btnText = theme.colors.button.primary.tint;
  const accent = '#4F46E5';

  const handlePurchase = async () => {
    if (isPurchasing) return;
    setIsPurchasing(true);
    try {
      const result = await sync.purchaseProduct(selectedTier.id);
      if (result.success) {
        Modal.alert(t('support.thankYouTitle'), t('support.purchaseSuccess', { name: selectedTier.name }));
      } else if (
        result.error &&
        !result.error.includes('cancelled') &&
        !result.error.includes('取消')
      ) {
        Modal.alert(t('support.purchaseFailed'), result.error);
      }
    } catch (error: any) {
      Modal.alert(t('support.purchaseFailed'), error?.message || t('support.unknownError'));
    } finally {
      setIsPurchasing(false);
    }
  };

  if (isPro) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <Stack.Screen options={{ title: t('support.title'), headerShown: true }} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Ionicons name="checkmark-circle" size={64} color="#34C759" />
          <Text
            style={{
              fontSize: 22,
              fontWeight: '700',
              color: theme.colors.text,
              marginTop: 20,
              marginBottom: 8,
            }}
          >
            {t('support.thankYouMessage')}
          </Text>
          <Text
            style={{
              fontSize: 15,
              color: theme.colors.textSecondary,
              textAlign: 'center',
              lineHeight: 22,
            }}
          >
            {t('support.thankYouDescription')}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.groupped.background }}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack.Screen options={{ title: t('support.title'), headerShown: true }} />

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
        <View style={{ marginBottom: 24 }}>
          <Text
            style={{ fontSize: 22, fontWeight: '700', color: theme.colors.text, marginBottom: 6 }}
          >
            {t('support.supportDevelopment')}
          </Text>
          <Text style={{ fontSize: 14, color: theme.colors.textSecondary, lineHeight: 20 }}>
            {t('support.supportDescription')}
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
                  <View
                    style={{
                      alignSelf: 'flex-start',
                      backgroundColor: accent,
                      borderRadius: 4,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      marginBottom: 10,
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '600', color: '#fff' }}>{t('support.recommended')}</Text>
                  </View>
                )}
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: '600',
                        color: theme.colors.text,
                        marginBottom: 3,
                      }}
                    >
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
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>
                      {tier.period}
                    </Text>
                  </View>
                </View>
                <View style={{ marginTop: 12, gap: 5 }}>
                  {tier.features.map((f, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Ionicons
                        name="checkmark"
                        size={13}
                        color={isSelected ? accent : theme.colors.textSecondary}
                      />
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
            {isPurchasing
              ? t('support.processing')
              : t('support.joinTier', { name: selectedTier.name, price: selectedTier.price, period: selectedTier.period })}
          </Text>
        </Pressable>

        <Text
          style={{
            fontSize: 12,
            color: theme.colors.textSecondary,
            textAlign: 'center',
            marginTop: 10,
          }}
        >
          {t('support.cancellableSecurePayment')}
        </Text>

        {__DEV__ && (
          <View
            style={{
              marginTop: 32,
              padding: 14,
              backgroundColor: theme.colors.surface,
              borderRadius: 10,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '600',
                color: theme.colors.textSecondary,
                marginBottom: 8,
              }}
            >
              开发诊断
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginBottom: 2 }}>
              平台: {Platform.OS}
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginBottom: 2 }}>
              Stripe Key:{' '}
              {config.revenueCatStripeKey
                ? `✅ ${config.revenueCatStripeKey.slice(0, 12)}...`
                : '❌ 未设置'}
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginBottom: 8 }}>
              RevenueCat: {sync.revenueCatInitialized ? '✅ 已初始化' : '❌ 未初始化'}
            </Text>
            <Pressable
              onPress={async () => {
                try {
                  await sync.purchasesSync.invalidateAndAwait();
                  Modal.alert(
                    '诊断',
                    sync.revenueCatInitialized ? '✅ 初始化成功' : '❌ 初始化失败，请查看控制台'
                  );
                } catch (e: any) {
                  Modal.alert('诊断错误', e?.message || safeStringify(e));
                }
              }}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 12,
                backgroundColor: btnBg,
                borderRadius: 6,
                alignSelf: 'flex-start',
              }}
            >
              <Text style={{ fontSize: 11, color: btnText, fontWeight: '600' }}>
                手动触发初始化
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
