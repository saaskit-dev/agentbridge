import { Stack, useRouter } from 'expo-router';
import * as React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Dimensions,
  Animated,
  PanResponder,
  Platform,
} from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useEntitlement } from '@/sync/storage';
import { sync } from '@/sync/sync';
import { trackPaywallButtonClicked } from '@/track';
import { Modal } from '@/modal';
import { config } from '@/config';
import { config } from '@/config';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// 定价档位 - 完全新的概念
// 注意：这些 id 需要与 RevenueCat 后台配置的产品 ID 对应
// RevenueCat 配置步骤：
// 1. 在 RevenueCat Dashboard 创建产品（Products）
// 2. 创建权益（Entitlements）名为 'pro'
// 3. 创建 Offerings，将产品添加到 offering 中
const TIERS = [
  {
    id: 'coffee_monthly', // 在 RevenueCat 后台创建此产品 ID
    icon: '☕',
    name: '咖啡伙伴',
    price: '¥12',
    period: '月',
    description: '一杯咖啡，让开发更有动力',
    features: ['应用内无赞助标识', '优先获得新功能体验'],
    color: ['#8B4513', '#D2691E'],
  },
  {
    id: 'builder_monthly', // 在 RevenueCat 后台创建此产品 ID
    icon: '🚀',
    name: '共建者',
    price: '¥38',
    period: '月',
    description: '与我们一起塑造未来的编程方式',
    features: ['所有咖啡伙伴权益', '专属 Discord 频道', '每月一对一答疑'],
    color: ['#667eea', '#764ba2'],
    popular: true,
  },
  {
    id: 'pioneer_monthly', // 在 RevenueCat 后台创建此产品 ID
    icon: '💎',
    name: '先行者',
    price: '¥98',
    period: '月',
    description: '为先锋而生的专属体验',
    features: ['所有共建者权益', '提前体验实验性功能', '定制化需求优先实现', '专属技术咨询'],
    color: ['#f093fb', '#f5576c'],
  },
];

// 3D 卡片组件
function TierCard({
  tier,
  index,
  selectedIndex,
  onSelect,
}: {
  tier: (typeof TIERS)[0];
  index: number;
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const { theme } = useUnistyles();
  const isSelected = index === selectedIndex;
  const distance = Math.abs(index - selectedIndex);

  // 动画值
  const animatedValue = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.spring(animatedValue, {
      toValue: isSelected ? 1 : 0,
      useNativeDriver: true,
      friction: 8,
      tension: 40,
    }).start();
  }, [isSelected]);

  const translateY = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [distance * 20, -20],
  });

  const scale = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [1 - distance * 0.1, 1.05],
  });

  const opacity = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [1 - distance * 0.3, 1],
  });

  return (
    <Pressable onPress={() => onSelect(index)}>
      <Animated.View
        style={{
          width: SCREEN_WIDTH * 0.75,
          height: 420,
          marginHorizontal: 10,
          borderRadius: 24,
          overflow: 'hidden',
          transform: [{ translateY }, { scale }],
          opacity,
          shadowColor: tier.color[0],
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: isSelected ? 0.4 : 0.1,
          shadowRadius: isSelected ? 30 : 10,
          elevation: isSelected ? 20 : 5,
        }}
      >
        <LinearGradient
          colors={tier.color as [string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            flex: 1,
            padding: 24,
            justifyContent: 'space-between',
          }}
        >
          {/* 角标 */}
          {tier.popular && (
            <View
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                backgroundColor: 'rgba(255,255,255,0.25)',
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 12,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                最受欢迎
              </Text>
            </View>
          )}

          {/* 头部 */}
          <View>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>{tier.icon}</Text>
            <Text
              style={{
                fontSize: 28,
                fontWeight: '800',
                color: '#fff',
                marginBottom: 8,
              }}
            >
              {tier.name}
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: 'rgba(255,255,255,0.8)',
                lineHeight: 20,
              }}
            >
              {tier.description}
            </Text>
          </View>

          {/* 价格 */}
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginVertical: 20 }}>
            <Text style={{ fontSize: 48, fontWeight: '800', color: '#fff' }}>
              {tier.price}
            </Text>
            <Text style={{ fontSize: 16, color: 'rgba(255,255,255,0.7)', marginLeft: 4 }}>
              /{tier.period}
            </Text>
          </View>

          {/* 权益列表 */}
          <View style={{ gap: 10 }}>
            {tier.features.map((feature, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="checkmark-circle" size={18} color="rgba(255,255,255,0.9)" />
                <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)', flex: 1 }}>
                  {feature}
                </Text>
              </View>
            ))}
          </View>
        </LinearGradient>
      </Animated.View>
    </Pressable>
  );
}

// 粒子背景效果
function ParticleBackground() {
  const particles = React.useMemo(() => {
    return Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * SCREEN_WIDTH,
      y: Math.random() * SCREEN_HEIGHT,
      size: Math.random() * 4 + 2,
      duration: Math.random() * 3000 + 2000,
      delay: Math.random() * 2000,
    }));
  }, []);

  return (
    <View style={{ position: 'absolute', width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}>
      {particles.map((p) => (
        <AnimatedParticle key={p.id} {...p} />
      ))}
    </View>
  );
}

function AnimatedParticle({
  x,
  y,
  size,
  duration,
  delay,
}: {
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
}) {
  const animatedValue = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(animatedValue, {
          toValue: 1,
          duration,
          useNativeDriver: true,
        }),
        Animated.timing(animatedValue, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, []);

  const translateY = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -100],
  });

  const opacity = animatedValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0.6, 0],
  });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#667eea',
        opacity,
        transform: [{ translateY }],
      }}
    />
  );
}

export default function SupportScreen() {
  const { theme } = useUnistyles();
  const router = useRouter();
  const isPro = useEntitlement('pro');
  const [selectedIndex, setSelectedIndex] = React.useState(1); // 默认选中中间档位
  const [isPurchasing, setIsPurchasing] = React.useState(false);
  const scrollViewRef = React.useRef<ScrollView>(null);

  // 自动滚动到选中项
  React.useEffect(() => {
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollTo({
        x: selectedIndex * (SCREEN_WIDTH * 0.75 + 20) - SCREEN_WIDTH * 0.125,
        animated: true,
      });
    }
  }, [selectedIndex]);

  const handlePurchase = async () => {
    if (isPurchasing) return;

    const tier = TIERS[selectedIndex];
    trackPaywallButtonClicked();
    setIsPurchasing(true);

    try {
      // 直接购买选中的产品
      const result = await sync.purchaseProduct(tier.id);

      if (result.success) {
        Modal.alert(
          '🎉 欢迎加入！',
          `您已成为「${tier.name}」，感谢您的支持，让我们一起创造更好的未来。`
        );
      } else if (result.error) {
        // 用户取消不显示错误
        if (!result.error.includes('cancelled') && !result.error.includes('取消')) {
          Modal.alert('购买失败', result.error);
        }
      }
    } catch (error: any) {
      console.error('Purchase error:', error);
      Modal.alert('购买失败', error?.message || '未知错误，请重试');
    } finally {
      setIsPurchasing(false);
    }
  };

  // 如果已经是 Pro，显示感谢页面
  if (isPro) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <Stack.Screen options={{ headerShown: false }} />

        <ParticleBackground />

        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <View
            style={{
              width: 120,
              height: 120,
              borderRadius: 60,
              backgroundColor: '#667eea',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 32,
              shadowColor: '#667eea',
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.5,
              shadowRadius: 30,
            }}
          >
            <Text style={{ fontSize: 60 }}>💎</Text>
          </View>

          <Text
            style={{
              fontSize: 32,
              fontWeight: '800',
              color: theme.colors.text,
              textAlign: 'center',
              marginBottom: 16,
            }}
          >
            您是尊贵的共建者
          </Text>

          <Text
            style={{
              fontSize: 16,
              color: theme.colors.textSecondary,
              textAlign: 'center',
              lineHeight: 24,
              marginBottom: 40,
            }}
          >
            正是因为有您的支持，我们才能持续创新，为开发者打造更好的工具。{'\n'}
            感谢您成为这段旅程的一部分。
          </Text>

          <Pressable
            onPress={() => router.back()}
            style={{
              backgroundColor: theme.colors.surface,
              paddingHorizontal: 32,
              paddingVertical: 16,
              borderRadius: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Ionicons name="arrow-back" size={20} color={theme.colors.text} />
            <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.text }}>
              返回
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack.Screen options={{ headerShown: false }} />

      <ParticleBackground />

      {/* 顶部导航 */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          paddingTop: 50,
          paddingHorizontal: 20,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: 'rgba(255,255,255,0.1)',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Ionicons name="close" size={24} color={theme.colors.text} />
        </Pressable>

        <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>
          选择适合您的方式
        </Text>

        <View style={{ width: 40 }} />
      </View>

      {/* 头部文案 */}
      <View style={{ paddingTop: 100, paddingHorizontal: 30, marginBottom: 20 }}>
        <Text
          style={{
            fontSize: 14,
            fontWeight: '700',
            color: '#667eea',
            marginBottom: 12,
            letterSpacing: 2,
            textTransform: 'uppercase',
          }}
        >
          加入共建
        </Text>
        <Text
          style={{
            fontSize: 32,
            fontWeight: '800',
            color: theme.colors.text,
            marginBottom: 12,
            lineHeight: 40,
          }}
        >
          成为{'\n'}未来的一部分
        </Text>
        <Text
          style={{
            fontSize: 15,
            color: theme.colors.textSecondary,
            lineHeight: 22,
          }}
        >
          您的支持不仅是一份订阅，更是一次对创新的投资。
          与数千名开发者一起，塑造编程的未来。
        </Text>
      </View>

      {/* 卡片轮播 */}
      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: SCREEN_WIDTH * 0.125,
          paddingVertical: 20,
        }}
        snapToInterval={SCREEN_WIDTH * 0.75 + 20}
        decelerationRate="fast"
        onMomentumScrollEnd={(e) => {
          const index = Math.round(
            e.nativeEvent.contentOffset.x / (SCREEN_WIDTH * 0.75 + 20)
          );
          setSelectedIndex(Math.max(0, Math.min(index, TIERS.length - 1)));
        }}
      >
        {TIERS.map((tier, index) => (
          <TierCard
            key={tier.id}
            tier={tier}
            index={index}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
          />
        ))}
      </ScrollView>

      {/* 底部按钮 */}
      <View
        style={{
          padding: 30,
          paddingBottom: 50,
          alignItems: 'center',
        }}
      >
        <Pressable
          onPress={handlePurchase}
          disabled={isPurchasing}
          style={({ pressed }) => ({
            width: '100%',
            height: 56,
            borderRadius: 28,
            backgroundColor: '#667eea',
            justifyContent: 'center',
            alignItems: 'center',
            opacity: isPurchasing ? 0.7 : pressed ? 0.9 : 1,
            shadowColor: '#667eea',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.4,
            shadowRadius: 16,
          })}
        >
          <Text
            style={{
              fontSize: 17,
              fontWeight: '700',
              color: '#fff',
            }}
          >
            {isPurchasing ? '处理中...' : `加入 ${TIERS[selectedIndex].name}`}
          </Text>
        </Pressable>

        <Text
          style={{
            fontSize: 12,
            color: theme.colors.textSecondary,
            marginTop: 16,
            textAlign: 'center',
          }}
        >
          可随时取消订阅 • 安全支付处理
        </Text>

        {/* 诊断信息 - 开发时显示 */}
        {__DEV__ && (
          <View style={{ marginTop: 30, padding: 16, backgroundColor: theme.colors.surface, borderRadius: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: theme.colors.textSecondary, marginBottom: 8 }}>
              🔧 诊断信息 (仅开发可见)
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginBottom: 4 }}>
              平台: {Platform.OS}
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginBottom: 4 }}>
              Apple Key: {config.revenueCatAppleKey ? '✅ 已配置' : '❌ 未配置'}
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginBottom: 4 }}>
              Google Key: {config.revenueCatGoogleKey ? '✅ 已配置' : '❌ 未配置'}
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginBottom: 4 }}>
              Stripe Key: {config.revenueCatStripeKey ? '✅ 已配置' : '❌ 未配置'}
            </Text>
            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, marginBottom: 4 }}>
              RevenueCat 初始化: {sync.revenueCatInitialized ? '✅ 已初始化' : '❌ 未初始化'}
            </Text>
            <Pressable
              onPress={() => {
                sync.refreshPurchases();
                Modal.alert('诊断', '已尝试刷新购买状态，请查看控制台日志');
              }}
              style={{
                marginTop: 12,
                paddingVertical: 8,
                paddingHorizontal: 16,
                backgroundColor: '#667eea',
                borderRadius: 8,
                alignSelf: 'flex-start',
              }}
            >
              <Text style={{ fontSize: 12, color: '#fff', fontWeight: '600' }}>
                刷新 RevenueCat 状态
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}
