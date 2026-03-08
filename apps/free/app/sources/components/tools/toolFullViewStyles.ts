import { Platform } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { layout } from '../layout';

export const toolFullViewStyles = StyleSheet.create(theme => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    paddingTop: 12,
  },
  contentWrapper: {
    maxWidth: layout.maxWidth,
    alignSelf: 'center',
    width: '100%',
  },
  section: {
    marginBottom: 28,
    paddingHorizontal: 4,
  },
  sectionFullWidth: {
    marginBottom: 28,
    paddingHorizontal: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: theme.colors.text,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.textSecondary,
  },
  toolId: {
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    color: theme.colors.textSecondary,
  },
  errorContainer: {
    backgroundColor: theme.colors.box.error.background,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.box.error.border,
  },
  errorText: {
    fontSize: 14,
    color: theme.colors.box.error.text,
    lineHeight: 20,
  },
  emptyOutputContainer: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  emptyOutputText: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
  },
  emptyOutputSubtext: {
    fontSize: 14,
    color: theme.colors.textSecondary,
  },
}));
