import type { TranslationStructure } from '../_default';

/**
 * English plural helper function
 * English has 2 plural forms: singular, plural
 * @param options - Object containing count, singular, and plural forms
 * @returns The appropriate form based on English plural rules
 */
function plural({
  count,
  singular,
  plural,
}: {
  count: number;
  singular: string;
  plural: string;
}): string {
  return count === 1 ? singular : plural;
}

/**
 * ENGLISH TRANSLATIONS - DEDICATED FILE
 *
 * This file represents the new translation architecture where each language
 * has its own dedicated file instead of being embedded in _default.ts.
 *
 * STRUCTURE CHANGE:
 * - Previously: All languages in _default.ts as objects
 * - Now: Separate files for each language (en.ts, ru.ts, pl.ts, es.ts, etc.)
 * - Benefit: Better maintainability, smaller files, easier language management
 *
 * This file contains the complete English translation structure and serves as
 * the reference implementation for all other language files.
 *
 * ARCHITECTURE NOTES:
 * - All translation keys must match across all language files
 * - Type safety enforced by TranslationStructure interface
 * - New translation keys must be added to ALL language files
 */
export const en: TranslationStructure = {
  tabs: {
    // Tab navigation labels
    inbox: 'Inbox',
    sessions: 'Sessions',
    settings: 'Settings',
  },

  inbox: {
    // Inbox screen
    emptyTitle: 'Empty Inbox',
    emptyDescription: 'Connect with friends to start sharing sessions',
    updates: 'Updates',
  },

  common: {
    // Simple string constants
    cancel: 'Cancel',
    authenticate: 'Authenticate',
    save: 'Save',
    saveAs: 'Save As',
    error: 'Error',
    success: 'Success',
    ok: 'OK',
    continue: 'Continue',
    back: 'Back',
    create: 'Create',
    rename: 'Rename',
    reset: 'Reset',
    logout: 'Logout',
    yes: 'Yes',
    no: 'No',
    discard: 'Discard',
    version: 'Version',
    copy: 'Copy',
    copied: 'Copied',
    scanning: 'Scanning...',
    urlPlaceholder: 'https://example.com',
    home: 'Home',
    message: 'Message',
    files: 'Files',
    fileViewer: 'File Viewer',
    loading: 'Loading...',
    retry: 'Retry',
    delete: 'Delete',
    optional: 'optional',
  },

  profile: {
    userProfile: 'User Profile',
    details: 'Details',
    firstName: 'First Name',
    lastName: 'Last Name',
    username: 'Username',
    status: 'Status',
  },

  status: {
    connected: 'connected',
    connecting: 'connecting',
    disconnected: 'disconnected',
    error: 'error',
    authError: 'session expired, logging out...',
    online: 'online',
    offline: 'offline',
    lastSeen: ({ time }: { time: string }) => `last seen ${time}`,
    permissionRequired: 'permission required',
    recoveryFailed: 'recovery failed',
    activeNow: 'Active now',
    unknown: 'unknown',
    machinesOnline: ({ count }: { count: number }) =>
      count === 0 ? 'no machines' : `${count} machine${count !== 1 ? 's' : ''} online`,
  },

  time: {
    justNow: 'just now',
    minutesAgo: ({ count }: { count: number }) => `${count} minute${count !== 1 ? 's' : ''} ago`,
    hoursAgo: ({ count }: { count: number }) => `${count} hour${count !== 1 ? 's' : ''} ago`,
  },

  connect: {
    restoreAccount: 'Restore Account',
    enterSecretKey: 'Please enter a secret key',
    invalidSecretKey: 'Invalid secret key. Please check and try again.',
    enterUrlManually: 'Enter URL manually',
    connectName: ({ name }: { name: string }) => `Connect ${name}`,
    runCommandInTerminal: 'Run the following command in your terminal:',
  },

  restore: {
    enterSecretKeyInstruction: 'Enter your secret key to restore access to your account.',
    secretKeyPlaceholder: 'XXXXX-XXXXX-XXXXX...',
    qrStep1: '1. Open Free on your mobile device',
    qrStep2: '2. Go to Settings → Account',
    qrStep3: '3. Tap "Link New Device"',
    qrStep4: '4. Scan this QR code',
    restoreWithSecretKeyInstead: 'Restore with Secret Key Instead',
  },

  settings: {
    title: 'Settings',
    connectedAccounts: 'Connected Accounts',
    connectAccount: 'Connect account',
    github: 'GitHub',
    machines: 'Machines',
    features: 'Features',
    social: 'Social',
    account: 'Account',
    accountSubtitle: 'Manage your account details',
    appearance: 'Appearance',
    appearanceSubtitle: 'Customize how the app looks',
    featuresTitle: 'Features',
    featuresSubtitle: 'Enable or disable app features',
    developer: 'Developer',
    exitDeveloperMode: 'Exit Developer Mode',
    developerTools: 'Developer Tools',
    about: 'About',
    aboutFooter:
      'Free is a multi-agent mobile client supporting Claude Code, Codex, Gemini and more. Fully end-to-end encrypted with accounts stored only on your device.',
    whatsNew: "What's New",
    whatsNewSubtitle: 'See the latest updates and improvements',
    reportIssue: 'Report an Issue',
    privacyPolicy: 'Privacy Policy',
    termsOfService: 'Terms of Service',
    eula: 'EULA',
    scanQrCodeToAuthenticate: 'Scan QR code to authenticate',
    githubConnected: ({ login }: { login: string }) => `Connected as @${login}`,
    connectGithubAccount: 'Connect your GitHub account',
    claudeAuthSuccess: 'Successfully connected to Claude',
    exchangingTokens: 'Exchanging tokens...',
    usage: 'Usage',
    usageSubtitle: 'View your API usage and costs',
    supportUs: 'Join Us',
    supportUsSubtitlePro: 'You are a Builder 🎉',
    supportUsSubtitle: 'Be part of the future',

    // Dynamic settings messages
    accountConnected: ({ service }: { service: string }) => `${service} account connected`,
    machineStatus: ({ name, status }: { name: string; status: 'online' | 'offline' }) =>
      `${name} is ${status}`,
    featureToggled: ({ feature, enabled }: { feature: string; enabled: boolean }) =>
      `${feature} ${enabled ? 'enabled' : 'disabled'}`,
  },

  settingsAppearance: {
    // Appearance settings screen
    theme: 'Theme',
    themeDescription: 'Choose your preferred color scheme',
    themeOptions: {
      adaptive: 'Adaptive',
      light: 'Light',
      dark: 'Dark',
    },
    themeDescriptions: {
      adaptive: 'Match system settings',
      light: 'Always use light theme',
      dark: 'Always use dark theme',
    },
    display: 'Display',
    displayDescription: 'Control layout and spacing',
    inlineToolCalls: 'Inline Tool Calls',
    inlineToolCallsDescription: 'Display tool calls directly in chat messages',
    expandTodoLists: 'Expand Todo Lists',
    expandTodoListsDescription: 'Show all todos instead of just changes',
    showLineNumbersInDiffs: 'Show Line Numbers in Diffs',
    showLineNumbersInDiffsDescription: 'Display line numbers in code diffs',
    showLineNumbersInToolViews: 'Show Line Numbers in Tool Views',
    showLineNumbersInToolViewsDescription: 'Display line numbers in tool view diffs',
    wrapLinesInDiffs: 'Wrap Lines in Diffs',
    wrapLinesInDiffsDescription: 'Wrap long lines instead of horizontal scrolling in diff views',
    alwaysShowContextSize: 'Always Show Context Size',
    alwaysShowContextSizeDescription: 'Display context usage even when not near limit',
    avatarStyle: 'Avatar Style',
    avatarStyleDescription: 'Choose session avatar appearance',
    avatarOptions: {
      pixelated: 'Pixelated',
      gradient: 'Gradient',
      brutalist: 'Brutalist',
    },
    showFlavorIcons: 'Show AI Provider Icons',
    showFlavorIconsDescription: 'Display AI provider icons on session avatars',
    compactSessionView: 'Compact Session View',
    compactSessionViewDescription: 'Show active sessions in a more compact layout',
  },

  settingsFeatures: {
    // Features settings screen
    experiments: 'Experiments',
    experimentsDescription:
      'Enable experimental features that are still in development. These features may be unstable or change without notice.',
    experimentalFeatures: 'Experimental Features',
    experimentalFeaturesEnabled: 'Experimental features enabled',
    experimentalFeaturesDisabled: 'Using stable features only',
    webFeatures: 'Web Features',
    webFeaturesDescription: 'Features available only in the web version of the app.',
    enterToSend: 'Enter to Send',
    enterToSendEnabled: 'Press Enter to send messages',
    enterToSendDisabled: 'Press ⌘+Enter to send messages',
    commandPalette: 'Command Palette',
    commandPaletteEnabled: 'Press ⌘K to open',
    commandPaletteDisabled: 'Quick command access disabled',
    markdownCopyV2: 'Markdown Copy v2',
    markdownCopyV2Subtitle: 'Long press opens copy modal',
    hideInactiveSessions: 'Hide inactive sessions',
    hideInactiveSessionsSubtitle: 'Show only active chats in your list',
    enhancedSessionWizard: 'Enhanced Session Wizard',
    enhancedSessionWizardEnabled: 'Profile-first session launcher active',
    enhancedSessionWizardDisabled: 'Using standard session launcher',

},

  errors: {
    networkError: 'Network error occurred',
    serverError: 'Server error occurred',
    unknownError: 'An unknown error occurred',
    connectionTimeout: 'Connection timed out',
    authenticationFailed: 'Authentication failed',
    permissionDenied: 'Permission denied',
    fileNotFound: 'File not found',
    invalidFormat: 'Invalid format',
    operationFailed: 'Operation failed',
    tryAgain: 'Please try again',
    contactSupport: 'Contact support if the problem persists',
    sessionNotFound: 'Session not found',
    voiceSessionFailed: 'Failed to start voice session',
    voiceServiceUnavailable: 'Voice service is temporarily unavailable',
    voiceNotConfigured: 'Voice feature is not configured. Please contact support.',
    voiceNotInitialized:
      'Voice service failed to initialize. Please restart the app and try again.',
    voiceMicPermissionWeb:
      'Microphone access is required for voice. Please allow microphone permission in your browser settings.',
    voiceTokenRejected: 'Voice service is not available on this server.',
    oauthInitializationFailed: 'Failed to initialize OAuth flow',
    tokenStorageFailed: 'Failed to store authentication tokens',
    oauthStateMismatch: 'Security validation failed. Please try again',
    tokenExchangeFailed: 'Failed to exchange authorization code',
    oauthAuthorizationDenied: 'Authorization was denied',
    webViewLoadFailed: 'Failed to load authentication page',
    failedToLoadProfile: 'Failed to load user profile',
    userNotFound: 'User not found',
    sessionDeleted: 'Session has been deleted',
    sessionDeletedDescription: 'This session has been permanently removed',

    // Error functions with context
    fieldError: ({ field, reason }: { field: string; reason: string }) => `${field}: ${reason}`,
    validationError: ({ field, min, max }: { field: string; min: number; max: number }) =>
      `${field} must be between ${min} and ${max}`,
    retryIn: ({ seconds }: { seconds: number }) =>
      `Retry in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`,
    errorWithCode: ({ message, code }: { message: string; code: number | string }) =>
      `${message} (Error ${code})`,
    disconnectServiceFailed: ({ service }: { service: string }) =>
      `Failed to disconnect ${service}`,
    connectServiceFailed: ({ service }: { service: string }) =>
      `Failed to connect ${service}. Please try again.`,
    failedToLoadFriends: 'Failed to load friends list',
    failedToAcceptRequest: 'Failed to accept friend request',
    failedToRejectRequest: 'Failed to reject friend request',
    failedToRemoveFriend: 'Failed to remove friend',
    searchFailed: 'Search failed. Please try again.',
    failedToSendRequest: 'Failed to send friend request',
  },

  newSession: {
    // Used by new-session screen and launch flows
    title: 'Start New Session',
    noMachinesFound: 'No machines found. Start a Free session on your computer first.',
    allMachinesOffline: 'All machines appear offline',
    machineDetails: 'View machine details →',
    directoryDoesNotExist: 'Directory Not Found',
    createDirectoryConfirm: ({ directory }: { directory: string }) =>
      `The directory ${directory} does not exist. Do you want to create it?`,
    sessionStarted: 'Session Started',
    sessionStartedMessage: 'The session has been started successfully.',
    sessionSpawningFailed: 'Session spawning failed - no session ID returned.',
    startingSession: 'Starting session...',
    startNewSessionInFolder: 'New session here',
    failedToStart:
      'Failed to start session. Make sure the daemon is running on the target machine.',
    sessionTimeout:
      'Session startup timed out. The machine may be slow or the daemon may not be responding.',
    notConnectedToServer: 'Not connected to server. Check your internet connection.',
    noMachineSelected: 'Please select a machine to start the session',
    noPathSelected: 'Please select a directory to start the session in',
    sessionType: {
      title: 'Session Type',
      simple: 'Simple',
      worktree: 'Worktree',
      comingSoon: 'Coming soon',
    },
    worktree: {
      creating: ({ name }: { name: string }) => `Creating worktree '${name}'...`,
      notGitRepo: 'Worktrees require a git repository',
      failed: ({ error }: { error: string }) => `Failed to create worktree: ${error}`,
      success: 'Worktree created successfully',
      branchConfigureTitle: 'Worktree branch',
      branchModalTitle: 'Worktree branch',
      branchModalOr: 'Or create a new branch',
      branchModalPriorityHint:
        'If you select an existing branch above, it takes priority over new branch fields.',
      branchModalEmptyHint: 'Leave all fields empty to auto-create a random branch.',
      branchPickerPlaceholder: 'Existing branch (optional)',
      branchPickerHint: 'Local branches',
      newBranchNamePlaceholder: 'New branch name (optional)',
      startPointPlaceholder: 'Start from (optional, e.g. main)',
      branchBindingRefresh: 'Refresh branch list',
      branchBindingNoBranches: 'No local branches found.',
      branchBindingLoadFailed: 'Could not load branches.',
      branchSummaryAuto: 'Auto — random branch',
      branchSummaryExisting: ({ branch }: { branch: string }) => `Existing: ${branch}`,
      branchSummaryNew: ({ name }: { name: string }) => `New branch: ${name}`,
      branchSummaryNewWithStart: ({ name, start }: { name: string; start: string }) =>
        `New: ${name} from ${start}`,
      branchSummaryAutoFrom: ({ start }: { start: string }) => `Auto from ${start}`,
    },
    inputPlaceholder: 'What would you like to work on?',
    capabilityDiscoveryNotice: 'Send your first message to load modes, models, and commands.',
  },

  agentPicker: {
    headerTitle: 'Select Agent',
    heroEyebrow: 'Implementation Picker',
    heroTitle: 'Choose the runtime you want to start with.',
    heroDescription:
      'Each option below is discovered from the registered implementations on the selected machine. Classic and ACP entries stay separate on purpose.',
    experimentalSection: 'Experimental',
    experimentalCaption: 'Optional agents behind the experiments setting.',
    noAgentsTitle: 'No agents available',
    noAgentsDescription: 'This machine did not report any runnable implementations.',
    tagAcp: 'ACP',
    tagClassic: 'Classic',
    tagAnthropic: 'Anthropic',
    tagOpenAI: 'OpenAI',
    tagGoogle: 'Google',
    tagTerminal: 'Terminal',
    tagExperimental: 'Experimental',
  },

  machinePicker: {
    headerTitle: 'Select Machine',
    noMachinesAvailable: 'No machines available',
    online: 'online',
    offline: 'offline',
    searchPlaceholder: 'Type to filter machines...',
    recentSection: 'Recent Machines',
    favoritesSection: 'Favorite Machines',
    allSection: 'All Machines',
  },

  pathPicker: {
    headerTitle: 'Select Path',
    noMachineSelected: 'No machine selected',
    enterPath: 'Enter Path',
    enterPathPlaceholder: 'Enter path (e.g. /home/user/projects)',
    recentPaths: 'Recent Paths',
    suggestedPaths: 'Suggested Paths',
    browse: 'Browse',
    browseError: 'Unable to load directory',
    emptyDirectory: 'No subdirectories',
  },

  sessionHistory: {
    // Used by session history screen
    title: 'Session History',
    empty: 'No sessions found',
    today: 'Today',
    yesterday: 'Yesterday',
    daysAgo: ({ count }: { count: number }) => `${count} ${count === 1 ? 'day' : 'days'} ago`,
    viewAll: 'View all sessions',
  },

  session: {
    inputPlaceholder: 'Type a message ...',
    sendFailed: 'Send failed. Tap to retry.',
    sendBlockedServerDisconnected: 'Server disconnected, cannot send message',
    sendBlockedDaemonOffline: 'Session offline, cannot send message',
    addImage: 'Add Image',
    pickLatestPhoto: 'Latest Photo',
    chooseFromLibrary: 'Choose from Library',
    latestPhotoUnavailable:
      'Could not load a photo. Allow library access or add photos to your library.',
  },

  commandPalette: {
    placeholder: 'Type a command or search...',
  },

  server: {
    // Used by Server Configuration screen (app/(app)/server.tsx)
    serverConfiguration: 'Server Configuration',
    enterServerUrl: 'Please enter a server URL',
    notValidFreeServer: 'Not a valid Free Server',
    changeServer: 'Change Server',
    continueWithServer: 'Continue with this server?',
    resetToDefault: 'Reset to Default',
    resetServerDefault: 'Reset server to default?',
    validating: 'Validating...',
    validatingServer: 'Validating server...',
    serverReturnedError: 'Server returned an error',
    failedToConnectToServer: 'Failed to connect to server',
    currentlyUsingCustomServer: 'Currently using custom server',
    customServerUrlLabel: 'Custom Server URL',
    advancedFeatureFooter:
      "This is an advanced feature. Only change the server if you know what you're doing. You will need to log out and log in again after changing servers.",
  },

  sessionInfo: {
    // Used by Session Info screen (app/(app)/session/[id]/info.tsx)
    killSession: 'Kill Session',
    killSessionConfirm: 'Are you sure you want to terminate this session?',
    archiveSession: 'Archive Session',
    archiveSessionConfirm: 'Are you sure you want to archive this session?',
    freeSessionIdCopied: 'Free Session ID copied to clipboard',
    failedToCopySessionId: 'Failed to copy Free Session ID',
    freeSessionId: 'Free Session ID',
    agentSessionId: 'Claude Code Session ID',
    agentSessionIdCopied: 'Claude Code Session ID copied to clipboard',
    aiProvider: 'AI Provider',
    failedToCopyAgentSessionId: 'Failed to copy Claude Code Session ID',
    metadataCopied: 'Metadata copied to clipboard',
    failedToCopyMetadata: 'Failed to copy metadata',
    failedToKillSession: 'Failed to kill session',
    failedToArchiveSession: 'Failed to archive session',
    connectionStatus: 'Connection Status',
    created: 'Created',
    lastUpdated: 'Last Updated',
    sequence: 'Sequence',
    quickActions: 'Quick Actions',
    viewMachine: 'View Machine',
    viewMachineSubtitle: 'View machine details and sessions',
    killSessionSubtitle: 'Immediately terminate the session',
    archiveSessionSubtitle: 'Archive this session and stop it',
    recoveryFailedArchiveSubtitle: 'This session failed to recover after a crash',
    metadata: 'Metadata',
    host: 'Host',
    path: 'Path',
    operatingSystem: 'Operating System',
    processId: 'Process ID',
    freeHome: 'Free Home',
    copyMetadata: 'Copy Metadata',
    agentState: 'Agent State',
    controlledByUser: 'Controlled by User',
    pendingRequests: 'Pending Requests',
    activity: 'Activity',
    thinking: 'Thinking',
    thinkingSince: 'Thinking Since',
    cliVersion: 'CLI Version',
    cliVersionOutdated: 'CLI Update Required',
    cliVersionOutdatedMessage: ({
      currentVersion,
      requiredVersion,
    }: {
      currentVersion: string;
      requiredVersion: string;
    }) => `Version ${currentVersion} installed. Update to ${requiredVersion} or later`,
    updateCliInstructions:
      'Please run npm install -g @saaskit-dev/free',
    restartAgent: 'Force Restart Agent',
    restartAgentConfirm: 'This will kill the current agent process and start a fresh one. The session and conversation history will be preserved.',
    restartAgentSubtitle: 'Kill and restart the agent process',
    restartAgentSuccess: 'Agent process is restarting.',
    failedToRestartAgent: 'Failed to restart agent',
    deleteSession: 'Delete Session',
    deleteSessionSubtitle: 'Permanently remove this session',
    deleteSessionConfirm: 'Delete Session Permanently?',
    deleteSessionWarning:
      'This action cannot be undone. All messages and data associated with this session will be permanently deleted.',
    failedToDeleteSession: 'Failed to delete session',
    sessionDeleted: 'Session deleted successfully',
    clearCache: 'Clear Cache',
    clearCacheSubtitle: 'Clear local cached data for this session',
    clearCacheConfirm: 'Clear all cached data for this session? Messages will be re-fetched from the server.',
    clearCacheSuccess: 'Cache cleared successfully',
    clearCacheFailed: 'Failed to clear cache',
  },

  components: {
    emptyMainScreen: {
      // Used by EmptyMainScreen component
      readyToCode: 'Ready to code?',
      installCli: 'Install the Free CLI',
      runIt: 'Run it',
      scanQrCode: 'Scan the QR code',
      openCamera: 'Open Camera',
    },
  },

  agentInput: {
    permissionMode: {
      title: 'PERMISSION MODE',
      readOnly: 'Read Only',
      acceptEdits: 'Accept Edits',
      yolo: 'YOLO',
      badgeReadOnly: 'Read Only',
      badgeAcceptEdits: 'Accept Edits',
      badgeYolo: 'YOLO',
    },
    agentTitle: 'Agent',
    agentModeTitle: 'Agent Mode',
    experimentalSection: 'Experimental',
    agent: {
      claude: 'Claude',
      codex: 'Codex',
      gemini: 'Gemini',
      opencode: 'OpenCode',
    },
    model: {
      title: 'MODEL',
      configureInCli: 'Configure models in CLI settings',
    },
    codexModel: {
      title: 'CODEX MODEL',
      gpt5CodexLow: 'gpt-5-codex low',
      gpt5CodexMedium: 'gpt-5-codex medium',
      gpt5CodexHigh: 'gpt-5-codex high',
      gpt5Minimal: 'GPT-5 Minimal',
      gpt5Low: 'GPT-5 Low',
      gpt5Medium: 'GPT-5 Medium',
      gpt5High: 'GPT-5 High',
    },
    context: {
      remaining: ({ percent }: { percent: number }) => `${percent}% left`,
    },
    suggestion: {
      fileLabel: 'FILE',
      folderLabel: 'FOLDER',
    },
    noMachinesAvailable: 'No machines',
    abortConfirmTitle: 'Stop current response?',
    abortConfirmMessage: 'The agent will stop working on this reply.',
    abortConfirmAction: 'Stop',
    abortTimedOut: 'Stop request timed out. Check your connection and try again.',
    speechInput: {
      recording: 'Listening...',
      permissionTitle: 'Microphone Access Required',
      permissionMessage: 'Please allow microphone and speech recognition access in system settings.',
      permissionCancel: 'Cancel',
      permissionOpenSettings: 'Open Settings',
      errorTitle: 'Speech Recognition Failed',
      errorMessage: ({ error }: { error: string }) => `Could not start speech recognition (${error}).`,
      languageUnavailableTitle: 'Language Pack Not Installed',
      languageUnavailableMessage: 'Speech recognition for the selected language needs to be downloaded. Open Settings to install it, or switch to English.',
      languageUnavailableCancel: 'Cancel',
      languageUnavailableOpenSettings: 'Open Settings',
      languageUnavailableUseEnglish: 'Use English',
    },
  },

  machineLauncher: {
    showLess: 'Show less',
    showAll: ({ count }: { count: number }) => `Show all (${count} paths)`,
    enterCustomPath: 'Enter custom path',
    offlineUnableToSpawn: 'Unable to spawn new session, offline',
  },

  sidebar: {
    sessionsTitle: 'Free',
  },

  toolView: {
    input: 'Input',
    output: 'Output',
  },

  tools: {
    fullView: {
      description: 'Description',
      inputParams: 'Input Parameters',
      output: 'Output',
      error: 'Error',
      completed: 'Tool completed successfully',
      noOutput: 'No output was produced',
      running: 'Tool is running...',
      rawJsonDevMode: 'Raw JSON (Dev Mode)',
    },
    taskView: {
      initializing: 'Initializing agent...',
      moreTools: ({ count }: { count: number }) =>
        `+${count} more ${plural({ count, singular: 'tool', plural: 'tools' })}`,
    },
    multiEdit: {
      editNumber: ({ index, total }: { index: number; total: number }) =>
        `Edit ${index} of ${total}`,
      replaceAll: 'Replace All',
    },
    names: {
      task: 'Task',
      terminal: 'Terminal',
      searchFiles: 'Search Files',
      search: 'Search',
      searchContent: 'Search Content',
      listFiles: 'List Files',
      planProposal: 'Plan proposal',
      readFile: 'Read File',
      editFile: 'Edit File',
      writeFile: 'Write File',
      fetchUrl: 'Fetch URL',
      readNotebook: 'Read Notebook',
      editNotebook: 'Edit Notebook',
      todoList: 'Todo List',
      webSearch: 'Web Search',
      toolSearch: 'Tool Search',
      reasoning: 'Reasoning',
      applyChanges: 'Update file',
      viewDiff: 'Current file changes',
      question: 'Question',
    },
    askUserQuestion: {
      submit: 'Submit Answer',
      multipleQuestions: ({ count }: { count: number }) => `${count} questions`,
      other: 'Other',
      otherDescription: 'Type your own answer',
      otherPlaceholder: 'Type your answer...',
    },
    desc: {
      terminalCmd: ({ cmd }: { cmd: string }) => `Terminal(cmd: ${cmd})`,
      searchPattern: ({ pattern }: { pattern: string }) => `Search(pattern: ${pattern})`,
      searchPath: ({ basename }: { basename: string }) => `Search(path: ${basename})`,
      fetchUrlHost: ({ host }: { host: string }) => `Fetch URL(url: ${host})`,
      editNotebookMode: ({ path, mode }: { path: string; mode: string }) =>
        `Edit Notebook(file: ${path}, mode: ${mode})`,
      todoListCount: ({ count }: { count: number }) => `Todo List(count: ${count})`,
      webSearchQuery: ({ query }: { query: string }) => `Web Search(query: ${query})`,
      grepPattern: ({ pattern }: { pattern: string }) => `grep(pattern: ${pattern})`,
      multiEditEdits: ({ path, count }: { path: string; count: number }) =>
        `${path} (${count} edits)`,
      readingFile: ({ file }: { file: string }) => `Reading ${file}`,
      writingFile: ({ file }: { file: string }) => `Writing ${file}`,
      modifyingFile: ({ file }: { file: string }) => `Modifying ${file}`,
      modifyingFiles: ({ count }: { count: number }) => `Modifying ${count} files`,
      modifyingMultipleFiles: ({ file, count }: { file: string; count: number }) =>
        `${file} and ${count} more`,
      showingDiff: 'Showing changes',
    },
  },

  files: {
    searchPlaceholder: 'Search files...',
    detachedHead: 'detached HEAD',
    summary: ({ staged, unstaged }: { staged: number; unstaged: number }) =>
      `${staged} staged • ${unstaged} unstaged`,
    notRepo: 'Not a git repository',
    notUnderGit: 'This directory is not under git version control',
    searching: 'Searching files...',
    noFilesFound: 'No files found',
    noFilesInProject: 'No files in project',
    tryDifferentTerm: 'Try a different search term',
    searchResults: ({ count }: { count: number }) => `Search Results (${count})`,
    projectRoot: 'Project root',
    stagedChanges: ({ count }: { count: number }) => `Staged Changes (${count})`,
    unstagedChanges: ({ count }: { count: number }) => `Unstaged Changes (${count})`,
    // File viewer strings
    loadingFile: ({ fileName }: { fileName: string }) => `Loading ${fileName}...`,
    binaryFile: 'Binary File',
    cannotDisplayBinary: 'Cannot display binary file content',
    diff: 'Diff',
    file: 'File',
    fileEmpty: 'File is empty',
    noChanges: 'No changes to display',
    failedToDecodeContent: 'Failed to decode file content',
    failedToReadFile: 'Failed to read file',
    failedToLoadFile: 'Failed to load file',
    pathCopied: 'Path copied',
    fileSize: ({ bytes }: { bytes: number }) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    },
    browseTitle: 'Browse',
    browseFolderUp: 'Up',
    browseEmpty: 'This folder is empty',
    browseLoadFailed: 'Could not load this folder',
    browseNoPath:
      'Project path unavailable. Open this session from a machine where the CLI is connected.',
  },

  voiceStatusBar: {
    connecting: 'Connecting...',
    reconnecting: 'Reconnecting...',
    active: 'Voice Assistant Active',
    error: 'Connection Error',
    default: 'Voice Assistant',
    tapToEnd: 'Tap to end',
  },

  settingsAccount: {
    // Account settings screen
    accountInformation: 'Account Information',
    status: 'Status',
    statusActive: 'Active',
    statusNotAuthenticated: 'Not Authenticated',
    anonymousId: 'Anonymous ID',
    publicId: 'Public ID',
    notAvailable: 'Not available',
    linkNewDevice: 'Link New Device',
    linkNewDeviceSubtitle: 'Scan QR code to link device',
    profile: 'Profile',
    name: 'Name',
    github: 'GitHub',
    tapToDisconnect: 'Tap to disconnect',
    server: 'Server',
    backup: 'Backup',
    backupDescription:
      'Your secret key is the only way to recover your account. Save it in a secure place like a password manager.',
    secretKey: 'Secret Key',
    tapToReveal: 'Tap to reveal',
    tapToHide: 'Tap to hide',
    secretKeyLabel: 'SECRET KEY (TAP TO COPY)',
    secretKeyCopied: 'Secret key copied to clipboard. Store it in a safe place!',
    secretKeyCopyFailed: 'Failed to copy secret key',
    privacy: 'Privacy',
    privacyDescription:
      'Help improve the app by sharing anonymous usage data. No personal information is collected.',
    analytics: 'Analytics',
    analyticsDisabled: 'No data is shared',
    analyticsEnabled: 'Anonymous usage data is shared',
    dangerZone: 'Danger Zone',
    logout: 'Logout',
    logoutSubtitle: 'Sign out and clear local data',
    logoutConfirm: 'Are you sure you want to logout? Make sure you have backed up your secret key!',
  },

  settingsLanguage: {
    // Language settings screen
    title: 'Language',
    description:
      'Choose your preferred language for the app interface. This will sync across all your devices.',
    currentLanguage: 'Current Language',
    automatic: 'Automatic',
    automaticSubtitle: 'Detect from device settings',
    needsRestart: 'Language Changed',
    needsRestartMessage: 'The app needs to restart to apply the new language setting.',
    restartNow: 'Restart Now',
  },

  connectButton: {
    authenticate: 'Authenticate Terminal',
    authenticateWithUrlPaste: 'Authenticate Terminal with URL paste',
    pasteAuthUrl: 'Paste the auth URL from your terminal',
  },

  updateBanner: {
    updateAvailable: 'Update available',
    pressToApply: 'Press to apply the update',
    whatsNew: "What's new",
    seeLatest: 'See the latest updates and improvements',
    nativeUpdateAvailable: 'App Update Available',
    tapToUpdateAppStore: 'Tap to update in App Store',
    tapToUpdatePlayStore: 'Tap to update in Play Store',
  },

  changelog: {
    // Used by the changelog screen
    version: ({ version }: { version: number }) => `Version ${version}`,
    noEntriesAvailable: 'No changelog entries available.',
  },

  terminal: {
    // Used by terminal connection screens
    webBrowserRequired: 'Web Browser Required',
    webBrowserRequiredDescription:
      'Terminal connection links can only be opened in a web browser for security reasons. Please use the QR code scanner or open this link on a computer.',
    processingConnection: 'Processing connection...',
    invalidConnectionLink: 'Invalid Connection Link',
    invalidConnectionLinkDescription:
      'The connection link is missing or invalid. Please check the URL and try again.',
    connectTerminal: 'Connect Terminal',
    terminalRequestDescription:
      'A terminal is requesting to connect to your Free Coder account. This will allow the terminal to send and receive messages securely.',
    connectionDetails: 'Connection Details',
    publicKey: 'Public Key',
    encryption: 'Encryption',
    endToEndEncrypted: 'End-to-end encrypted',
    acceptConnection: 'Accept Connection',
    createAccountAndAccept: 'Create Account & Accept',
    creatingAccount: 'Creating account...',
    connecting: 'Connecting...',
    reject: 'Reject',
    security: 'Security',
    securityFooter:
      'This connection link was processed securely in your browser and was never sent to any server. Your private data will remain secure and only you can decrypt the messages.',
    securityFooterDevice:
      'This connection was processed securely on your device and was never sent to any server. Your private data will remain secure and only you can decrypt the messages.',
    clientSideProcessing: 'Client-Side Processing',
    linkProcessedLocally: 'Link processed locally in browser',
    linkProcessedOnDevice: 'Link processed locally on device',
  },

  modals: {
    // Used across connect flows and settings
    authenticateTerminal: 'Authenticate Terminal',
    pasteUrlFromTerminal: 'Paste the authentication URL from your terminal',
    deviceLinkedSuccessfully: 'Device linked successfully',
    terminalConnectedSuccessfully: 'Terminal connected successfully',
    invalidAuthUrl: 'Invalid authentication URL',
    developerMode: 'Developer Mode',
    developerModeEnabled: 'Developer mode enabled',
    developerModeDisabled: 'Developer mode disabled',
    disconnectGithub: 'Disconnect GitHub',
    disconnectGithubConfirm: 'Are you sure you want to disconnect your GitHub account?',
    disconnectService: ({ service }: { service: string }) => `Disconnect ${service}`,
    disconnectServiceConfirm: ({ service }: { service: string }) =>
      `Are you sure you want to disconnect ${service} from your account?`,
    disconnect: 'Disconnect',
    failedToConnectTerminal: 'Failed to connect terminal',
    cameraPermissionsRequiredToConnectTerminal:
      'Camera permissions are required to connect terminal',
    failedToLinkDevice: 'Failed to link device',
    cameraPermissionsRequiredToScanQr: 'Camera permissions are required to scan QR codes',
  },

  navigation: {
    // Navigation titles and screen headers
    connectTerminal: 'Connect Terminal',
    linkNewDevice: 'Link New Device',
    restoreWithSecretKey: 'Restore with Secret Key',
    whatsNew: "What's New",
    friends: 'Friends',
    importExistingAgentSessions: 'Import Existing Agent Sessions',
    connectTo: ({ name }: { name: string }) => `Connect to ${name}`,
    developerTools: 'Developer Tools',
    listComponentsDemo: 'List Components Demo',
    typography: 'Typography',
    colors: 'Colors',
    toolViewsDemo: 'Tool Views Demo',
    shimmerViewDemo: 'Shimmer View Demo',
    multiTextInput: 'Multi Text Input',
  },

  welcome: {
    // Main welcome screen for unauthenticated users
    title: 'Multi-Agent Mobile Client',
    subtitle: 'Command AI agents anytime, anywhere. Enhanced workflows for smarter automation.',
    createAccount: 'Create account',
    linkOrRestoreAccount: 'Link or restore account',
    loginWithMobileApp: 'Login with mobile app',
  },

  review: {
    // Used by utils/requestReview.ts
    enjoyingApp: 'Enjoying the app?',
    feedbackPrompt: "We'd love to hear your feedback!",
    yesILoveIt: 'Yes, I love it!',
    notReally: 'Not really',
  },

  items: {
    // Used by Item component for copy toast
    copiedToClipboard: ({ label }: { label: string }) => `${label} copied to clipboard`,
  },

  machine: {
    launchNewSessionInDirectory: 'Launch New Session in Directory',
    offlineUnableToSpawn: 'Launcher disabled while machine is offline',
    offlineHelp:
      '• Make sure your computer is online\n• Run `free daemon status` to diagnose\n• Are you running the latest CLI version? Upgrade with `npm install -g @saaskit-dev/free`',
    daemon: 'Daemon',
    status: 'Status',
    stopDaemon: 'Stop Daemon',
    lastKnownPid: 'Last Known PID',
    lastKnownHttpPort: 'Last Known HTTP Port',
    startedAt: 'Started At',
    cliVersion: 'CLI Version',
    daemonStateVersion: 'Daemon State Version',
    activeSessions: ({ count }: { count: number }) => `Active Sessions (${count})`,
    machineGroup: 'Machine',
    host: 'Host',
    machineId: 'Machine ID',
    username: 'Username',
    homeDirectory: 'Home Directory',
    platform: 'Platform',
    architecture: 'Architecture',
    lastSeen: 'Last Seen',
    never: 'Never',
    metadataVersion: 'Metadata Version',
    untitledSession: 'Untitled Session',
    back: 'Back',
    enterCustomPath: 'Enter custom path',
    previousSessions: 'Previous Sessions (up to 5 most recent)',
    machineNotFound: 'Machine not found',
    stopDaemonConfirmTitle: 'Stop Daemon?',
    stopDaemonConfirmMessage: 'You will not be able to spawn new sessions on this machine until you restart the daemon on your computer again. Your current sessions will stay alive.',
    daemonStopped: 'Daemon Stopped',
    failedToStopDaemon: 'Failed to stop daemon. It may not be running.',
    renameMachine: 'Rename Machine',
    renameMachineMessage: 'Give this machine a custom name. Leave empty to use the default hostname.',
    enterMachineName: 'Enter machine name',
    machineRenamed: 'Machine renamed successfully',
    createDirectoryTitle: 'Create Directory?',
    createDirectoryMessage: ({ directory }: { directory: string }) => `The directory '${directory}' does not exist. Would you like to create it?`,
    failedToStartSession: 'Failed to start session. Make sure the daemon is running on the target machine.',
  },

  message: {
    switchedToMode: ({ mode }: { mode: string }) => `Switched to ${mode} mode`,
    unknownEvent: 'Unknown event',
    usageLimitUntil: ({ time }: { time: string }) => `Usage limit reached until ${time}`,
    unknownTime: 'unknown time',
    permissionRequest: ({ toolName }: { toolName: string }) => 'Permission request for ' + toolName,
    permissionMode: ({ mode }: { mode: string }) => 'Permission mode: ' + mode,
  },

  chatList: {
    pullToRefresh: 'Pull to refresh',
    releaseToRefresh: 'Release to refresh',
    refreshing: 'Refreshing...',
    pullToLoadEarlier: 'Pull to load earlier',
    releaseToLoadEarlier: 'Release to load earlier',
    loadingEarlier: 'Loading...',
    scrollToBottom: 'Scroll to bottom',
    newMessages: ({ count }: { count: number }) =>
      `${count} new ${count === 1 ? 'message' : 'messages'}`,
    today: 'Today',
    yesterday: 'Yesterday',
  },

  codex: {
    // Codex permission dialog buttons
    permissions: {
      yesForSession: "Yes, and don't ask for a session",
      stopAndExplain: 'Stop, and explain what to do',
    },
  },

  claude: {
    // Claude permission dialog buttons
    permissions: {
      yesAllowAllEdits: 'Yes, allow all edits during this session',
      yesForTool: "Yes, don't ask again for this tool",
      noTellClaude: 'No, and provide feedback',
    },
  },

  textSelection: {
    // Text selection screen
    selectText: 'Select text range',
    title: 'Select Text',
    noTextProvided: 'No text provided',
    textNotFound: 'Text not found or expired',
    textCopied: 'Text copied to clipboard',
    failedToCopy: 'Failed to copy text to clipboard',
    noTextToCopy: 'No text available to copy',
  },

  markdown: {
    // Markdown copy functionality
    codeCopied: 'Code copied',
    copyFailed: 'Failed to copy',
    mermaidRenderFailed: 'Failed to render mermaid diagram',
  },

  artifacts: {
    // Artifacts feature
    title: 'Artifacts',
    countSingular: '1 artifact',
    countPlural: ({ count }: { count: number }) => `${count} artifacts`,
    empty: 'No artifacts yet',
    emptyDescription: 'Create your first artifact to get started',
    new: 'New Artifact',
    edit: 'Edit Artifact',
    delete: 'Delete',
    updateError: 'Failed to update artifact. Please try again.',
    notFound: 'Artifact not found',
    discardChanges: 'Discard changes?',
    discardChangesDescription: 'You have unsaved changes. Are you sure you want to discard them?',
    deleteConfirm: 'Delete artifact?',
    deleteConfirmDescription: 'This action cannot be undone',
    titleLabel: 'TITLE',
    titlePlaceholder: 'Enter a title for your artifact',
    bodyLabel: 'CONTENT',
    bodyPlaceholder: 'Write your content here...',
    emptyFieldsError: 'Please enter a title or content',
    createError: 'Failed to create artifact. Please try again.',
    save: 'Save',
    saving: 'Saving...',
    loading: 'Loading artifacts...',
    error: 'Failed to load artifact',
  },

  friends: {
    // Friends feature
    title: 'Friends',
    manageFriends: 'Manage your friends and connections',
    searchTitle: 'Find Friends',
    pendingRequests: 'Friend Requests',
    myFriends: 'My Friends',
    noFriendsYet: "You don't have any friends yet",
    findFriends: 'Find Friends',
    remove: 'Remove',
    pendingRequest: 'Pending',
    sentOn: ({ date }: { date: string }) => `Sent on ${date}`,
    accept: 'Accept',
    reject: 'Reject',
    addFriend: 'Add Friend',
    alreadyFriends: 'Already Friends',
    requestPending: 'Request Pending',
    searchInstructions: 'Enter a username to search for friends',
    searchPlaceholder: 'Enter username...',
    searching: 'Searching...',
    userNotFound: 'User not found',
    noUserFound: 'No user found with that username',
    checkUsername: 'Please check the username and try again',
    howToFind: 'How to Find Friends',
    findInstructions:
      'Search for friends by their username. Both you and your friend need to have GitHub connected to send friend requests.',
    requestSent: 'Friend request sent!',
    requestAccepted: 'Friend request accepted!',
    requestRejected: 'Friend request rejected',
    friendRemoved: 'Friend removed',
    confirmRemove: 'Remove Friend',
    confirmRemoveMessage: 'Are you sure you want to remove this friend?',
    cannotAddYourself: 'You cannot send a friend request to yourself',
    bothMustHaveGithub: 'Both users must have GitHub connected to become friends',
    status: {
      none: 'Not connected',
      requested: 'Request sent',
      pending: 'Request pending',
      friend: 'Friends',
      rejected: 'Rejected',
    },
    acceptRequest: 'Accept Request',
    removeFriend: 'Remove Friend',
    removeFriendConfirm: ({ name }: { name: string }) =>
      `Are you sure you want to remove ${name} as a friend?`,
    requestSentDescription: ({ name }: { name: string }) =>
      `Your friend request has been sent to ${name}`,
    requestFriendship: 'Request friendship',
    cancelRequest: 'Cancel friendship request',
    cancelRequestConfirm: ({ name }: { name: string }) =>
      `Cancel your friendship request to ${name}?`,
    denyRequest: 'Deny friendship',
    nowFriendsWith: ({ name }: { name: string }) => `You are now friends with ${name}`,
  },

  usage: {
    // Usage panel strings
    today: 'Today',
    last7Days: 'Last 7 days',
    last30Days: 'Last 30 days',
    totalTokens: 'Total Tokens',
    totalCost: 'Total Cost',
    tokens: 'Tokens',
    cost: 'Cost',
    usageOverTime: 'Usage over time',
    byModel: 'By Model',
    noData: 'No usage data available',
  },

  support: {
    tierCoffee: 'Coffee Buddy',
    tierCoffeePrice: '¥12',
    tierCoffeePeriod: '/mo',
    tierCoffeeDescription: 'A cup of coffee to fuel development',
    tierCoffeeFeature1: 'No sponsor badge in app',
    tierCoffeeFeature2: 'Early access to new features',
    tierBuilder: 'Builder',
    tierBuilderPrice: '¥38',
    tierBuilderPeriod: '/mo',
    tierBuilderDescription: 'Shape the future of coding together',
    tierBuilderFeature1: 'All Coffee Buddy perks',
    tierBuilderFeature2: 'Exclusive Discord channel',
    tierBuilderFeature3: 'Monthly 1-on-1 Q&A',
    tierPioneer: 'Pioneer',
    tierPioneerPrice: '¥98',
    tierPioneerPeriod: '/mo',
    tierPioneerDescription: 'An exclusive experience for trailblazers',
    tierPioneerFeature1: 'All Builder perks',
    tierPioneerFeature2: 'Early access to experimental features',
    tierPioneerFeature3: 'Priority for custom requests',
    tierPioneerFeature4: 'Dedicated tech consulting',
    title: 'Support',
    thankYouTitle: 'Thank You',
    purchaseSuccess: ({ name }: { name: string }) => `You are now a「${name}」. Thank you for your support!`,
    purchaseFailed: 'Purchase Failed',
    unknownError: 'Unknown error, please try again',
    thankYouMessage: 'Thank you for your support',
    thankYouDescription: 'You are a valued Builder. Your support drives our continued innovation.',
    supportDevelopment: 'Support Development',
    supportDescription: 'Your support drives our continued innovation. Choose a plan that works for you and shape the future of coding together.',
    recommended: 'Recommended',
    processing: 'Processing...',
    joinTier: ({ name, price, period }: { name: string; price: string; period: string }) => `Join ${name} · ${price}${period}`,
    cancellableSecurePayment: 'Cancel anytime · Secure payment',
  },

  dev: {
    appInformation: 'App Information',
    version: 'Version',
    buildNumber: 'Build Number',
    runtimeVersion: 'Runtime Version',
    packageSource: 'Package Source',
    buildTime: 'Build Time',
    sdkVersion: 'SDK Version',
    platform: 'Platform',
    anonymousId: 'Anonymous ID',
    notAvailable: 'Not available',
    debugOptions: 'Debug Options',
    showDebugIds: 'Show Debug IDs',
    showDebugIdsSubtitle: 'Show session IDs, agent IDs, and raw JSON in session info',
    componentDemos: 'Component Demos',
    deviceInfo: 'Device Info',
    deviceInfoSubtitle: 'Safe area insets and device parameters',
    listComponents: 'List Components',
    listComponentsSubtitle: 'Demo of Item, ItemGroup, and ItemList',
    typography: 'Typography',
    typographySubtitle: 'All typography styles',
    colors: 'Colors',
    colorsSubtitle: 'Color palette and themes',
    messageDemos: 'Message Demos',
    messageDemosSubtitle: 'Various message types and components',
    invertedListTest: 'Inverted List Test',
    invertedListTestSubtitle: 'Test inverted FlatList with keyboard',
    toolViews: 'Tool Views',
    toolViewsSubtitle: 'Tool call visualization components',
    shimmerView: 'Shimmer View',
    shimmerViewSubtitle: 'Shimmer loading effects with masks',
    multiTextInput: 'Multi Text Input',
    multiTextInputSubtitle: 'Auto-growing multiline text input',
    inputStyles: 'Input Styles',
    inputStylesSubtitle: '10+ different input field style variants',
    modalSystem: 'Modal System',
    modalSystemSubtitle: 'Alert, confirm, and custom modals',
    unitTests: 'Unit Tests',
    unitTestsSubtitle: 'Run tests in the app environment',
    unistylesDemo: 'Unistyles Demo',
    unistylesDemoSubtitle: 'React Native Unistyles features and capabilities',
    qrCodeTest: 'QR Code Test',
    qrCodeTestSubtitle: 'Test QR code generation with different parameters',
    testFeatures: 'Test Features',
    testFeaturesFooter: 'These actions may affect app stability',
    claudeOAuthTest: 'Claude OAuth Test',
    claudeOAuthTestSubtitle: 'Test Claude authentication flow',
    testCrash: 'Test Crash',
    testCrashSubtitle: 'Trigger a test crash',
    testCrashConfirmTitle: 'Test Crash',
    testCrashConfirmMessage: 'This will crash the app. Continue?',
    crash: 'Crash',
    clearCache: 'Clear Cache',
    clearCacheSubtitle: 'Remove all cached data',
    clearCacheConfirmTitle: 'Clear Cache',
    clearCacheConfirmMessage: 'Are you sure you want to clear all cached data? Messages will be re-fetched from the server.',
    clear: 'Clear',
    cacheCleared: 'Cache has been cleared',
    failedToClearCache: ({ error }: { error: string }) => `Failed to clear cache: ${error}`,
    resetChangelog: 'Reset Changelog',
    resetChangelogSubtitle: "Show 'What's New' banner again",
    changelogReset: 'Changelog reset. Restart app to see the banner.',
    resetAppState: 'Reset App State',
    resetAppStateSubtitle: 'Clear all user data and preferences',
    resetApp: 'Reset App',
    resetAppConfirmMessage: 'This will delete all data. Are you sure?',
    system: 'System',
    purchases: 'Purchases',
    purchasesSubtitle: 'View subscriptions and entitlements',
    expoConstants: 'Expo Constants',
    expoConstantsSubtitle: 'View expoConfig, manifests, and system constants',
    network: 'Network',
    apiEndpoint: 'API Endpoint',
    socketIoStatus: 'Socket.IO Status',
    editApiEndpoint: 'Edit API Endpoint',
    enterServerUrl: 'Enter the server URL:',
    serverUrlUpdated: 'Server URL updated. Please restart the app for changes to take effect.',
    invalidUrl: 'Invalid URL',
    invalidUrlDefault: 'Please enter a valid URL',
    justNow: 'Just now',
    secondsAgo: ({ seconds }: { seconds: number }) => `${seconds}s ago`,
    minutesAgo: ({ minutes }: { minutes: number }) => `${minutes}m ago`,
    hoursAgo: ({ hours }: { hours: number }) => `${hours}h ago`,
    daysAgo: ({ days }: { days: number }) => `${days}d ago`,
    connectedAgo: ({ time }: { time: string }) => `Connected ${time}`,
    lastConnectedAgo: ({ time }: { time: string }) => `Last connected ${time}`,
    connectingToServer: 'Connecting to server...',
    noConnectionInfo: 'No connection info',
    done: 'Done',
  },

  feed: {
    // Feed notifications for friend requests and acceptances
    friendRequestFrom: ({ name }: { name: string }) => `${name} sent you a friend request`,
    friendRequestGeneric: 'New friend request',
    friendAccepted: ({ name }: { name: string }) => `You are now friends with ${name}`,
    friendAcceptedGeneric: 'Friend request accepted',
  },
} as const;

export type TranslationsEn = typeof en;
