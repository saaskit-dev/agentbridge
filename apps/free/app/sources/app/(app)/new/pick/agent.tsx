import { Ionicons } from '@expo/vector-icons';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Typography } from '@/constants/Typography';
import { machineListSupportedAgents } from '@/sync/ops';
import { useSetting } from '@/sync/storage';
import {
  coerceAgentType,
  getAgentDescription,
  getAgentDisplayName,
  isExperimentalAgent,
  type AppAgentFlavor,
} from '@/sync/agentFlavor';
import { t } from '@/text';

const stylesheet = StyleSheet.create(theme => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.groupped.background,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 18,
  },
  hero: {
    padding: 18,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    gap: 10,
  },
  heroEyebrow: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: theme.colors.surfacePressed,
  },
  heroEyebrowText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    ...Typography.default('semiBold'),
  },
  heroTitle: {
    fontSize: 24,
    lineHeight: 28,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  heroDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  section: {
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 16,
    lineHeight: 20,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  sectionCaption: {
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  sectionCount: {
    fontSize: 12,
    lineHeight: 16,
    color: theme.colors.textSecondary,
    ...Typography.default('semiBold'),
  },
  cards: {
    gap: 10,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    backgroundColor: theme.colors.surface,
    padding: 16,
    gap: 14,
  },
  cardSelected: {
    borderColor: theme.colors.button.primary.tint,
    backgroundColor: theme.colors.surfacePressed,
  },
  cardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.995 }],
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfacePressed,
  },
  iconWrapSelected: {
    backgroundColor: theme.colors.button.primary.tint,
  },
  cardText: {
    flex: 1,
    gap: 4,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  cardTitle: {
    fontSize: 16,
    lineHeight: 20,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  cardDescription: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: theme.colors.surfacePressed,
  },
  pillSelected: {
    backgroundColor: theme.colors.button.primary.tint,
  },
  pillText: {
    fontSize: 11,
    lineHeight: 14,
    color: theme.colors.textSecondary,
    ...Typography.default('semiBold'),
  },
  pillTextSelected: {
    color: theme.colors.button.primary.background,
  },
  selectedBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.button.primary.tint,
  },
  emptyState: {
    padding: 20,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.divider,
    backgroundColor: theme.colors.surface,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
}));

const FALLBACK_AGENT_TYPES: AppAgentFlavor[] = [
  'claude-acp',
  'codex-acp',
  'gemini',
  'opencode',
  'claude',
  'codex',
];

type AgentSection = {
  id: string;
  title: string;
  caption: string;
  items: AppAgentFlavor[];
};

function getAgentIcon(agentType: AppAgentFlavor): keyof typeof Ionicons.glyphMap {
  if (agentType.startsWith('claude')) return 'sparkles-outline';
  if (agentType.startsWith('codex')) return 'code-slash-outline';
  if (agentType === 'gemini') return 'logo-google';
  return 'terminal-outline';
}

function getAgentTags(agentType: AppAgentFlavor): string[] {
  const tags: string[] = [];
  if (agentType.endsWith('-acp')) {
    tags.push(t('agentPicker.tagAcp'));
  } else {
    tags.push(t('agentPicker.tagClassic'));
  }
  if (agentType.startsWith('claude')) {
    tags.push(t('agentPicker.tagAnthropic'));
  } else if (agentType.startsWith('codex')) {
    tags.push(t('agentPicker.tagOpenAI'));
  } else if (agentType === 'gemini') {
    tags.push(t('agentPicker.tagGoogle'));
  } else {
    tags.push(t('agentPicker.tagTerminal'));
  }
  if (isExperimentalAgent(agentType)) {
    tags.push(t('agentPicker.tagExperimental'));
  }
  return tags;
}

export default function AgentPickerScreen() {
  const { theme } = useUnistyles();
  const styles = stylesheet;
  const router = useRouter();
  const navigation = useNavigation();
  const experimentsEnabled = useSetting('experiments');
  const params = useLocalSearchParams<{ machineId?: string; selectedAgent?: string }>();
  const [agentTypes, setAgentTypes] = React.useState<AppAgentFlavor[]>(FALLBACK_AGENT_TYPES);

  React.useEffect(() => {
    if (!params.machineId) {
      return;
    }
    let cancelled = false;
    void machineListSupportedAgents(params.machineId).then(registeredAgentTypes => {
      if (cancelled || registeredAgentTypes.length === 0) {
        return;
      }
      setAgentTypes(registeredAgentTypes.map(agentType => coerceAgentType(agentType)));
    });
    return () => {
      cancelled = true;
    };
  }, [params.machineId]);

  const visibleAgentTypes = React.useMemo(
    () => agentTypes.filter(agentType => experimentsEnabled || !isExperimentalAgent(agentType)),
    [agentTypes, experimentsEnabled]
  );

  const selectedAgent = React.useMemo(() => {
    if (!params.selectedAgent) {
      return null;
    }
    return (
      visibleAgentTypes.find(agentType => agentType === coerceAgentType(params.selectedAgent)) ??
      null
    );
  }, [params.selectedAgent, visibleAgentTypes]);

  const sections = React.useMemo<AgentSection[]>(() => {
    // const stable = visibleAgentTypes.filter(agentType => !agentType.endsWith('-acp'));
    const experimental = visibleAgentTypes.filter(agentType => isExperimentalAgent(agentType));

    return [
      {
        id: 'experimental',
        title: t('agentPicker.experimentalSection'),
        caption: t('agentPicker.experimentalCaption'),
        items: experimental,
      },
    ].filter(section => section.items.length > 0);
  }, [visibleAgentTypes]);

  const handleSelectAgent = React.useCallback(
    (agentType: AppAgentFlavor) => {
      const state = navigation.getState();
      const previousRoute = state?.routes?.[state.index - 1];
      if (state && state.index > 0 && previousRoute) {
        navigation.dispatch({
          ...CommonActions.setParams({ agent: agentType }),
          source: previousRoute.key,
        } as never);
      }
      router.back();
    },
    [navigation, router]
  );

  if (visibleAgentTypes.length === 0) {
    return (
      <>
        <Stack.Screen
          options={{
            headerShown: true,
            headerTitle: t('agentPicker.headerTitle'),
            headerBackTitle: t('common.back'),
          }}
        />
        <View style={styles.container}>
          <View style={styles.contentContainer}>
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{t('agentPicker.noAgentsTitle')}</Text>
              <Text style={styles.emptyText}>
                {t('agentPicker.noAgentsDescription')}
              </Text>
            </View>
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t('agentPicker.headerTitle'),
          headerBackTitle: t('common.back'),
        }}
      />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroEyebrow}>
            <Text style={styles.heroEyebrowText}>{t('agentPicker.heroEyebrow')}</Text>
          </View>
          <Text style={styles.heroTitle}>{t('agentPicker.heroTitle')}</Text>
          <Text style={styles.heroDescription}>
            {t('agentPicker.heroDescription')}
          </Text>
        </View>

        {sections.map(section => (
          <View key={section.id} style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionCaption}>{section.caption}</Text>
              </View>
              <Text style={styles.sectionCount}>{section.items.length}</Text>
            </View>

            <View style={styles.cards}>
              {section.items.map(agentType => {
                const selected = agentType === selectedAgent;
                return (
                  <Pressable
                    key={agentType}
                    onPress={() => handleSelectAgent(agentType)}
                    style={({ pressed }) => [
                      styles.card,
                      selected && styles.cardSelected,
                      pressed && styles.cardPressed,
                    ]}
                  >
                    <View style={styles.cardTopRow}>
                      <View style={[styles.iconWrap, selected && styles.iconWrapSelected]}>
                        <Ionicons
                          name={getAgentIcon(agentType)}
                          size={20}
                          color={
                            selected
                              ? theme.colors.button.primary.background
                              : theme.colors.textSecondary
                          }
                        />
                      </View>

                      <View style={styles.cardText}>
                        <View style={styles.cardTitleRow}>
                          <Text style={styles.cardTitle}>{getAgentDisplayName(agentType)}</Text>
                          {selected && (
                            <View style={styles.selectedBadge}>
                              <Ionicons
                                name="checkmark"
                                size={14}
                                color={theme.colors.button.primary.background}
                              />
                            </View>
                          )}
                        </View>
                        <Text style={styles.cardDescription}>{getAgentDescription(agentType)}</Text>
                      </View>
                    </View>

                    <View style={styles.pillRow}>
                      {getAgentTags(agentType).map(tag => (
                        <View
                          key={`${agentType}-${tag}`}
                          style={[styles.pill, selected && styles.pillSelected]}
                        >
                          <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
                            {tag}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </>
  );
}
