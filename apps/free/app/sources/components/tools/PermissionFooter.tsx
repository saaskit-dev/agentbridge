import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { sessionAllow, sessionDeny } from '@/sync/ops';
import { storage } from '@/sync/storage';
import { t } from '@/text';
import { Logger } from '@agentbridge/core/telemetry';
const logger = new Logger('app/components/tools/PermissionFooter');

interface PermissionFooterProps {
  permission: {
    id: string;
    status: 'pending' | 'approved' | 'denied' | 'canceled';
    reason?: string;
    mode?: string;
    allowedTools?: string[];
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort';
  };
  sessionId: string;
  toolName: string;
  toolInput?: any;
  metadata?: any;
}

export const PermissionFooter: React.FC<PermissionFooterProps> = ({
  permission,
  sessionId,
  toolName,
  toolInput,
  metadata,
}) => {
  const { theme } = useUnistyles();
  const [loadingButton, setLoadingButton] = useState<'allow' | 'deny' | 'abort' | null>(null);
  const [loadingAllEdits, setLoadingAllEdits] = useState(false);
  const [loadingForSession, setLoadingForSession] = useState(false);

  // Check if this is a Codex or OpenCode session - check both metadata.flavor and tool name prefix
  // Codex and OpenCode (ACP agents) share the same permission button style
  const isCodex = metadata?.flavor === 'codex' || toolName.startsWith('Codex');
  const isOpenCode = metadata?.flavor === 'opencode';
  const useAcpPermissions = isCodex || isOpenCode;

  const handleApprove = async () => {
    if (
      permission.status !== 'pending' ||
      loadingButton !== null ||
      loadingAllEdits ||
      loadingForSession
    )
      return;

    setLoadingButton('allow');
    try {
      await sessionAllow(sessionId, permission.id);
    } catch (error) {
      logger.error('Failed to approve permission:', error);
    } finally {
      setLoadingButton(null);
    }
  };

  const handleApproveAllEdits = async () => {
    if (
      permission.status !== 'pending' ||
      loadingButton !== null ||
      loadingAllEdits ||
      loadingForSession
    )
      return;

    setLoadingAllEdits(true);
    try {
      await sessionAllow(sessionId, permission.id, 'accept-edits');
      // Update the session permission mode to 'accept-edits' for future permissions
      storage.getState().updateSessionPermissionMode(sessionId, 'accept-edits');
    } catch (error) {
      logger.error('Failed to approve all edits:', error);
    } finally {
      setLoadingAllEdits(false);
    }
  };

  const handleApproveForSession = async () => {
    if (
      permission.status !== 'pending' ||
      loadingButton !== null ||
      loadingAllEdits ||
      loadingForSession ||
      !toolName
    )
      return;

    setLoadingForSession(true);
    try {
      // Special handling for Bash tool - include exact command
      let toolIdentifier = toolName;
      if (toolName === 'Bash' && toolInput?.command) {
        const command = toolInput.command;
        toolIdentifier = `Bash(${command})`;
      }

      await sessionAllow(sessionId, permission.id, undefined, [toolIdentifier]);
    } catch (error) {
      logger.error('Failed to approve for session:', error);
    } finally {
      setLoadingForSession(false);
    }
  };

  const handleDeny = async () => {
    if (
      permission.status !== 'pending' ||
      loadingButton !== null ||
      loadingAllEdits ||
      loadingForSession
    )
      return;

    setLoadingButton('deny');
    try {
      await sessionDeny(sessionId, permission.id);
    } catch (error) {
      logger.error('Failed to deny permission:', error);
    } finally {
      setLoadingButton(null);
    }
  };

  // Codex-specific handlers
  const handleCodexApprove = async () => {
    if (permission.status !== 'pending' || loadingButton !== null || loadingForSession) return;

    setLoadingButton('allow');
    try {
      await sessionAllow(sessionId, permission.id, undefined, undefined, 'approved');
    } catch (error) {
      logger.error('Failed to approve permission:', error);
    } finally {
      setLoadingButton(null);
    }
  };

  const handleCodexApproveForSession = async () => {
    if (permission.status !== 'pending' || loadingButton !== null || loadingForSession) return;

    setLoadingForSession(true);
    try {
      await sessionAllow(sessionId, permission.id, undefined, undefined, 'approved_for_session');
    } catch (error) {
      logger.error('Failed to approve for session:', error);
    } finally {
      setLoadingForSession(false);
    }
  };

  const handleCodexAbort = async () => {
    if (permission.status !== 'pending' || loadingButton !== null || loadingForSession) return;

    setLoadingButton('abort');
    try {
      await sessionDeny(sessionId, permission.id, undefined, undefined, 'abort');
    } catch (error) {
      logger.error('Failed to abort permission:', error);
    } finally {
      setLoadingButton(null);
    }
  };

  const isApproved = permission.status === 'approved';
  const isDenied = permission.status === 'denied';
  const isPending = permission.status === 'pending';

  // Helper function to check if tool matches allowed pattern
  const isToolAllowed = (
    toolName: string,
    toolInput: any,
    allowedTools: string[] | undefined
  ): boolean => {
    if (!allowedTools) return false;

    // Direct match for non-Bash tools
    if (allowedTools.includes(toolName)) return true;

    // For Bash, check exact command match
    if (toolName === 'Bash' && toolInput?.command) {
      const command = toolInput.command;
      return allowedTools.includes(`Bash(${command})`);
    }

    return false;
  };

  // Detect which button was used based on mode (for Claude) or decision (for Codex)
  const isApprovedViaAllow =
    isApproved &&
    permission.mode !== 'accept-edits' &&
    !isToolAllowed(toolName, toolInput, permission.allowedTools);
  const isApprovedViaAllEdits = isApproved && permission.mode === 'accept-edits';
  const isApprovedForSession =
    isApproved && isToolAllowed(toolName, toolInput, permission.allowedTools);

  // ACP-style (Codex/OpenCode) status detection with fallback
  const isAcpApproved =
    useAcpPermissions && isApproved && (permission.decision === 'approved' || !permission.decision);
  const isAcpApprovedForSession =
    useAcpPermissions && isApproved && permission.decision === 'approved_for_session';
  const isAcpAborted = useAcpPermissions && isDenied && permission.decision === 'abort';

  const styles = StyleSheet.create({
    container: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      justifyContent: 'center',
    },
    buttonContainer: {
      flexDirection: 'column',
      gap: 4,
      alignItems: 'flex-start',
    },
    button: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 1,
      backgroundColor: 'transparent',
      alignItems: 'flex-start',
      justifyContent: 'center',
      minHeight: 32,
      borderLeftWidth: 3,
      borderLeftColor: 'transparent',
      alignSelf: 'stretch',
    },
    buttonAllow: {
      backgroundColor: 'transparent',
    },
    buttonDeny: {
      backgroundColor: 'transparent',
    },
    buttonAllowAll: {
      backgroundColor: 'transparent',
    },
    buttonSelected: {
      backgroundColor: 'transparent',
      borderLeftColor: theme.colors.text,
    },
    buttonInactive: {
      opacity: 0.3,
    },
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minHeight: 20,
    },
    icon: {
      marginRight: 2,
    },
    buttonText: {
      fontSize: 14,
      fontWeight: '400',
      color: theme.colors.textSecondary,
    },
    buttonTextAllow: {
      color: theme.colors.permissionButton.allow.background,
      fontWeight: '500',
    },
    buttonTextDeny: {
      color: theme.colors.permissionButton.deny.background,
      fontWeight: '500',
    },
    buttonTextAllowAll: {
      color: theme.colors.permissionButton.allowAll.background,
      fontWeight: '500',
    },
    buttonTextSelected: {
      color: theme.colors.text,
      fontWeight: '500',
    },
    buttonForSession: {
      backgroundColor: 'transparent',
    },
    buttonTextForSession: {
      color: theme.colors.permissionButton.allowAll.background,
      fontWeight: '500',
    },
    loadingIndicatorAllow: {
      color: theme.colors.permissionButton.allow.background,
    },
    loadingIndicatorDeny: {
      color: theme.colors.permissionButton.deny.background,
    },
    loadingIndicatorAllowAll: {
      color: theme.colors.permissionButton.allowAll.background,
    },
    loadingIndicatorForSession: {
      color: theme.colors.permissionButton.allowAll.background,
    },
    iconApproved: {
      color: theme.colors.permissionButton.allow.background,
    },
    iconDenied: {
      color: theme.colors.permissionButton.deny.background,
    },
  });

  // Render ACP-style buttons for Codex/OpenCode sessions
  if (useAcpPermissions) {
    return (
      <View style={styles.container}>
        <View style={styles.buttonContainer}>
          {/* ACP: Yes button */}
          <TouchableOpacity
            style={[
              styles.button,
              isPending && styles.buttonAllow,
              isAcpApproved && styles.buttonSelected,
              (isAcpAborted || isAcpApprovedForSession) && styles.buttonInactive,
            ]}
            onPress={handleCodexApprove}
            disabled={!isPending || loadingButton !== null || loadingForSession}
            activeOpacity={isPending ? 0.7 : 1}
          >
            {loadingButton === 'allow' && isPending ? (
              <View
                style={[styles.buttonContent, { width: 40, height: 20, justifyContent: 'center' }]}
              >
                <ActivityIndicator
                  size={Platform.OS === 'ios' ? 'small' : (14 as any)}
                  color={styles.loadingIndicatorAllow.color}
                />
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Text
                  style={[
                    styles.buttonText,
                    isPending && styles.buttonTextAllow,
                    isAcpApproved && styles.buttonTextSelected,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {t('common.yes')}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* ACP: Yes, and don't ask for a session button */}
          <TouchableOpacity
            style={[
              styles.button,
              isPending && styles.buttonForSession,
              isAcpApprovedForSession && styles.buttonSelected,
              (isAcpAborted || isAcpApproved) && styles.buttonInactive,
            ]}
            onPress={handleCodexApproveForSession}
            disabled={!isPending || loadingButton !== null || loadingForSession}
            activeOpacity={isPending ? 0.7 : 1}
          >
            {loadingForSession && isPending ? (
              <View
                style={[styles.buttonContent, { width: 40, height: 20, justifyContent: 'center' }]}
              >
                <ActivityIndicator
                  size={Platform.OS === 'ios' ? 'small' : (14 as any)}
                  color={styles.loadingIndicatorForSession.color}
                />
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Text
                  style={[
                    styles.buttonText,
                    isPending && styles.buttonTextForSession,
                    isAcpApprovedForSession && styles.buttonTextSelected,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {t('codex.permissions.yesForSession')}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* ACP: Stop, and explain what to do button */}
          <TouchableOpacity
            style={[
              styles.button,
              isPending && styles.buttonDeny,
              isAcpAborted && styles.buttonSelected,
              (isAcpApproved || isAcpApprovedForSession) && styles.buttonInactive,
            ]}
            onPress={handleCodexAbort}
            disabled={!isPending || loadingButton !== null || loadingForSession}
            activeOpacity={isPending ? 0.7 : 1}
          >
            {loadingButton === 'abort' && isPending ? (
              <View
                style={[styles.buttonContent, { width: 40, height: 20, justifyContent: 'center' }]}
              >
                <ActivityIndicator
                  size={Platform.OS === 'ios' ? 'small' : (14 as any)}
                  color={styles.loadingIndicatorDeny.color}
                />
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Text
                  style={[
                    styles.buttonText,
                    isPending && styles.buttonTextDeny,
                    isAcpAborted && styles.buttonTextSelected,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {t('codex.permissions.stopAndExplain')}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Render Claude buttons (existing behavior)
  return (
    <View style={styles.container}>
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[
            styles.button,
            isPending && styles.buttonAllow,
            isApprovedViaAllow && styles.buttonSelected,
            (isDenied || isApprovedViaAllEdits || isApprovedForSession) && styles.buttonInactive,
          ]}
          onPress={handleApprove}
          disabled={!isPending || loadingButton !== null || loadingAllEdits || loadingForSession}
          activeOpacity={isPending ? 0.7 : 1}
        >
          {loadingButton === 'allow' && isPending ? (
            <View
              style={[styles.buttonContent, { width: 40, height: 20, justifyContent: 'center' }]}
            >
              <ActivityIndicator
                size={Platform.OS === 'ios' ? 'small' : (14 as any)}
                color={styles.loadingIndicatorAllow.color}
              />
            </View>
          ) : (
            <View style={styles.buttonContent}>
              <Text
                style={[
                  styles.buttonText,
                  isPending && styles.buttonTextAllow,
                  isApprovedViaAllow && styles.buttonTextSelected,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {t('common.yes')}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Allow All Edits button - only show for Edit and MultiEdit tools */}
        {(toolName === 'Edit' ||
          toolName === 'MultiEdit' ||
          toolName === 'Write' ||
          toolName === 'NotebookEdit' ||
          toolName === 'exit_plan_mode' ||
          toolName === 'ExitPlanMode') && (
          <TouchableOpacity
            style={[
              styles.button,
              isPending && styles.buttonAllowAll,
              isApprovedViaAllEdits && styles.buttonSelected,
              (isDenied || isApprovedViaAllow || isApprovedForSession) && styles.buttonInactive,
            ]}
            onPress={handleApproveAllEdits}
            disabled={!isPending || loadingButton !== null || loadingAllEdits || loadingForSession}
            activeOpacity={isPending ? 0.7 : 1}
          >
            {loadingAllEdits && isPending ? (
              <View
                style={[styles.buttonContent, { width: 40, height: 20, justifyContent: 'center' }]}
              >
                <ActivityIndicator
                  size={Platform.OS === 'ios' ? 'small' : (14 as any)}
                  color={styles.loadingIndicatorAllowAll.color}
                />
              </View>
            ) : (
              <View style={styles.buttonContent}>
                <Text
                  style={[
                    styles.buttonText,
                    isPending && styles.buttonTextAllowAll,
                    isApprovedViaAllEdits && styles.buttonTextSelected,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {t('claude.permissions.yesAllowAllEdits')}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        )}

        {/* Allow for session button - only show for non-edit, non-exit-plan tools */}
        {toolName &&
          toolName !== 'Edit' &&
          toolName !== 'MultiEdit' &&
          toolName !== 'Write' &&
          toolName !== 'NotebookEdit' &&
          toolName !== 'exit_plan_mode' &&
          toolName !== 'ExitPlanMode' && (
            <TouchableOpacity
              style={[
                styles.button,
                isPending && styles.buttonForSession,
                isApprovedForSession && styles.buttonSelected,
                (isDenied || isApprovedViaAllow || isApprovedViaAllEdits) && styles.buttonInactive,
              ]}
              onPress={handleApproveForSession}
              disabled={
                !isPending || loadingButton !== null || loadingAllEdits || loadingForSession
              }
              activeOpacity={isPending ? 0.7 : 1}
            >
              {loadingForSession && isPending ? (
                <View
                  style={[
                    styles.buttonContent,
                    { width: 40, height: 20, justifyContent: 'center' },
                  ]}
                >
                  <ActivityIndicator
                    size={Platform.OS === 'ios' ? 'small' : (14 as any)}
                    color={styles.loadingIndicatorForSession.color}
                  />
                </View>
              ) : (
                <View style={styles.buttonContent}>
                  <Text
                    style={[
                      styles.buttonText,
                      isPending && styles.buttonTextForSession,
                      isApprovedForSession && styles.buttonTextSelected,
                    ]}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {t('claude.permissions.yesForTool')}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )}

        <TouchableOpacity
          style={[
            styles.button,
            isPending && styles.buttonDeny,
            isDenied && styles.buttonSelected,
            isApproved && styles.buttonInactive,
          ]}
          onPress={handleDeny}
          disabled={!isPending || loadingButton !== null || loadingAllEdits || loadingForSession}
          activeOpacity={isPending ? 0.7 : 1}
        >
          {loadingButton === 'deny' && isPending ? (
            <View
              style={[styles.buttonContent, { width: 40, height: 20, justifyContent: 'center' }]}
            >
              <ActivityIndicator
                size={Platform.OS === 'ios' ? 'small' : (14 as any)}
                color={styles.loadingIndicatorDeny.color}
              />
            </View>
          ) : (
            <View style={styles.buttonContent}>
              <Text
                style={[
                  styles.buttonText,
                  isPending && styles.buttonTextDeny,
                  isDenied && styles.buttonTextSelected,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {t('claude.permissions.noTellClaude')}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};
