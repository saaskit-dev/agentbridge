import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import * as React from 'react';
import { View, Text, StyleSheet, Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUnistyles } from 'react-native-unistyles';
import { Avatar } from '@/components/Avatar';
import { layout } from '@/components/layout';
import { Typography } from '@/constants/Typography';
import { useHeaderHeight } from '@/utils/responsive';

interface ChatHeaderViewProps {
  title: string;
  subtitle?: string;
  onBackPress?: () => void;
  onAvatarPress?: () => void;
  avatarId?: string;
  backgroundColor?: string;
  tintColor?: string;
  isConnected?: boolean;
  flavor?: string | null;
  /** Session ID shown in dev mode, centered in header, tap-to-copy */
  devSessionId?: string | null;
}

/** Small tap-to-copy badge for IDs in dev mode. Dark background pill for visibility on any header. */
function CopyableBadge({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const compact = value.replace(/-/g, '');
  const handlePress = React.useCallback(async () => {
    await Clipboard.setStringAsync(compact);
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1200);
  }, [compact]);
  return (
    <Pressable
      onPress={handlePress}
      hitSlop={4}
      style={{
        backgroundColor: 'rgba(0,0,0,0.55)',
        borderRadius: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Text
        style={{
          fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
          fontSize: 9,
          color: copied ? '#4ade80' : '#0f0',
        }}
      >
        {copied ? 'copied!' : `${label}:${compact}`}
      </Text>
    </Pressable>
  );
}

export const ChatHeaderView: React.FC<ChatHeaderViewProps> = ({
  title,
  subtitle,
  onBackPress,
  onAvatarPress,
  avatarId,
  isConnected = true,
  flavor,
  devSessionId,
}) => {
  const { theme } = useUnistyles();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  const handleBackPress = () => {
    if (onBackPress) {
      onBackPress();
    } else {
      navigation.goBack();
    }
  };

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, backgroundColor: theme.colors.header.background },
      ]}
    >
      <View style={styles.contentWrapper}>
        <View style={[styles.content, { height: headerHeight }]}>
          <Pressable onPress={handleBackPress} style={styles.backButton} hitSlop={15}>
            <Ionicons
              name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
              size={Platform.select({ ios: 28, default: 24 })}
              color={theme.colors.header.tint}
            />
          </Pressable>

          <View style={styles.titleContainer}>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={[
                styles.title,
                {
                  color: theme.colors.header.tint,
                  ...Typography.default('semiBold'),
                },
              ]}
            >
              {title}
            </Text>
            {subtitle && (
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.subtitle,
                  {
                    color: theme.colors.header.tint,
                    opacity: 0.7,
                    ...Typography.default(),
                  },
                ]}
              >
                {subtitle}
              </Text>
            )}
          </View>

          {/* Dev mode: session ID centered in header, tap-to-copy */}
          {!!devSessionId && (
            <View pointerEvents="box-none" style={styles.devIdContainer}>
              <CopyableBadge label="sid" value={devSessionId} />
            </View>
          )}

          {avatarId && onAvatarPress && (
            <Pressable onPress={onAvatarPress} hitSlop={15} style={styles.avatarButton}>
              <Avatar id={avatarId} size={32} monochrome={!isConnected} flavor={flavor} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 100,
  },
  contentWrapper: {
    width: '100%',
    alignItems: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Platform.OS === 'ios' ? 8 : 16,
    width: '100%',
    maxWidth: layout.headerMaxWidth,
  },
  backButton: {
    marginRight: 8,
  },
  titleContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: Platform.select({
      ios: 15,
      android: 15,
      default: 16,
    }),
    fontWeight: '600',
    marginBottom: 1,
    width: '100%',
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 14,
  },
  avatarButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Platform.select({ ios: -8, default: -8 }),
  },
  devIdContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 2,
    alignItems: 'center',
  },
});
