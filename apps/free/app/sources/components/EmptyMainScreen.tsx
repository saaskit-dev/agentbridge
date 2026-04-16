import React from 'react';
import { View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { RoundButton } from '@/components/RoundButton';
import { Text } from '@/components/StyledText';
import { Typography } from '@/constants/Typography';
import { useConnectTerminal } from '@/hooks/useConnectTerminal';
import { Modal } from '@/modal';
import { t } from '@/text';

const stylesheet = StyleSheet.create(theme => ({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  hero: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 28,
    padding: 24,
    backgroundColor: theme.colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.divider,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: theme.colors.groupped.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  heroEyebrow: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: theme.colors.textSecondary,
    ...Typography.default('semiBold'),
  },
  title: {
    fontSize: 26,
    color: theme.colors.text,
    ...Typography.default('semiBold'),
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: theme.colors.textSecondary,
    marginBottom: 18,
    ...Typography.default(),
  },
  terminalBlock: {
    backgroundColor: theme.colors.surfaceHighest,
    borderRadius: 18,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: theme.colors.divider,
  },
  terminalLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: theme.colors.textSecondary,
    marginBottom: 10,
    ...Typography.default('semiBold'),
  },
  terminalText: {
    ...Typography.mono(),
    fontSize: 15,
    color: theme.colors.status.connected,
  },
  terminalTextFirst: {
    marginBottom: 8,
  },
  stepsContainer: {
    marginBottom: 22,
    width: '100%',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  stepRowLast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.colors.groupped.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  stepNumberText: {
    ...Typography.default('semiBold'),
    fontSize: 14,
    color: theme.colors.text,
  },
  stepText: {
    ...Typography.default(),
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: theme.colors.textSecondary,
  },
  buttonsContainer: {
    width: '100%',
  },
  buttonWrapper: {
    width: '100%',
    marginBottom: 12,
  },
  buttonWrapperSecondary: {
    width: '100%',
  },
  secondaryHint: {
    marginTop: 10,
    textAlign: 'center',
    fontSize: 12,
    color: theme.colors.textSecondary,
    ...Typography.default(),
  },
}));

export function EmptyMainScreen() {
  const { connectTerminal, connectWithUrl, isLoading } = useConnectTerminal();
  const { theme } = useUnistyles();
  const styles = stylesheet;

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroIcon}>
            <Ionicons name="sparkles-outline" size={24} color={theme.colors.text} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroEyebrow}>{t('components.emptyMainScreen.commandLabel')}</Text>
            <Text style={styles.title}>{t('components.emptyMainScreen.readyToCode')}</Text>
          </View>
        </View>

        <Text style={styles.subtitle}>{t('components.emptyMainScreen.productSubtitle')}</Text>

        <View style={styles.terminalBlock}>
          <Text style={styles.terminalLabel}>{t('components.emptyMainScreen.commandLabel')}</Text>
          <Text style={[styles.terminalText, styles.terminalTextFirst]}>
            $ npm i -g @saaskit-dev/free
          </Text>
          <Text style={styles.terminalText}>$ free</Text>
        </View>

        {Platform.OS !== 'web' && (
          <View style={styles.stepsContainer}>
            <View style={styles.stepRow}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>1</Text>
              </View>
              <Text style={styles.stepText}>{t('components.emptyMainScreen.installCli')}</Text>
            </View>
            <View style={styles.stepRow}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>2</Text>
              </View>
              <Text style={styles.stepText}>{t('components.emptyMainScreen.runIt')}</Text>
            </View>
            <View style={styles.stepRowLast}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>3</Text>
              </View>
              <Text style={styles.stepText}>{t('components.emptyMainScreen.scanQrCode')}</Text>
            </View>
          </View>
        )}
        <View style={styles.buttonsContainer}>
          {Platform.OS !== 'web' && (
            <View style={styles.buttonWrapper}>
              <RoundButton
                title={t('components.emptyMainScreen.openCamera')}
                size="large"
                loading={isLoading}
                onPress={connectTerminal}
              />
            </View>
          )}
          <View style={Platform.OS === 'web' ? styles.buttonWrapper : styles.buttonWrapperSecondary}>
            <RoundButton
              title={t('connect.enterUrlManually')}
              size={Platform.OS === 'web' ? 'large' : 'normal'}
              display={Platform.OS === 'web' ? 'default' : 'inverted'}
              onPress={async () => {
                const url = await Modal.prompt(
                  t('modals.authenticateTerminal'),
                  t('modals.pasteUrlFromTerminal'),
                  {
                    placeholder: 'free://terminal?...',
                    cancelText: t('common.cancel'),
                    confirmText: t('common.authenticate'),
                  }
                );

                if (url?.trim()) {
                  connectWithUrl(url.trim());
                }
              }}
            />
            <Text style={styles.secondaryHint}>{t('components.emptyMainScreen.manualHint')}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
