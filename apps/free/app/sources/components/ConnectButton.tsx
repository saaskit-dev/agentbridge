import { Ionicons } from '@expo/vector-icons';
import * as React from 'react';
import { View, TextInput, Text, TouchableOpacity } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { RoundButton } from './RoundButton';
import { useConnectTerminal } from '@/hooks/useConnectTerminal';
import { t } from '@/text';

export const ConnectButton = React.memo(() => {
  const { connectTerminal, connectWithUrl, isLoading } = useConnectTerminal();
  const { theme } = useUnistyles();
  const [manualUrl, setManualUrl] = React.useState('');
  const [showManualEntry, setShowManualEntry] = React.useState(false);

  const handleConnect = async () => {
    connectTerminal();
  };

  const handleManualConnect = async () => {
    if (manualUrl.trim()) {
      connectWithUrl(manualUrl.trim());
      setManualUrl('');
    }
  };

  return (
    <View style={{ maxWidth: 280, width: '100%' }}>
      <RoundButton
        title={t('connectButton.authenticate')}
        size="large"
        onPress={handleConnect}
        loading={isLoading}
      />

      <TouchableOpacity
        onPress={() => setShowManualEntry(!showManualEntry)}
        style={{
          marginTop: 12,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons
          name="link-outline"
          size={16}
          color={theme.colors.textSecondary}
          style={{ marginRight: 6 }}
        />
        <Text
          style={{
            fontSize: 14,
            color: theme.colors.textSecondary,
            textDecorationLine: 'underline',
          }}
        >
          {t('connectButton.authenticateWithUrlPaste')}
        </Text>
      </TouchableOpacity>

      {showManualEntry && (
        <View
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 8,
            backgroundColor: theme.colors.surfaceHigh,
            width: '100%',
          }}
        >
          <Text
            style={{
              fontSize: 12,
              color: theme.colors.textSecondary,
              marginBottom: 8,
            }}
          >
            {t('connectButton.pasteAuthUrl')}
          </Text>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <TextInput
              style={{
                flex: 1,
                backgroundColor: theme.colors.surface,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                borderRadius: 6,
                padding: 8,
                fontSize: 12,
                color: theme.colors.text,
              }}
              value={manualUrl}
              onChangeText={setManualUrl}
              placeholder="free://terminal?..."
              placeholderTextColor={theme.colors.input.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={handleManualConnect}
            />
            <TouchableOpacity
              onPress={handleManualConnect}
              disabled={!manualUrl.trim()}
              style={{
                marginLeft: 8,
                padding: 8,
                opacity: manualUrl.trim() ? 1 : 0.5,
              }}
            >
              <Ionicons
                name="checkmark-circle"
                size={24}
                color={theme.colors.button.primary.background}
              />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
});
