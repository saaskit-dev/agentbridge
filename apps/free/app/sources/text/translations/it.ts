import type { TranslationStructure } from '../_default';

/**
 * Italian plural helper function
 * Italian has 2 plural forms: singular, plural
 * @param options - Object containing count, singular, and plural forms
 * @returns The appropriate form based on Italian plural rules
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
 * Italian translations for the Free app
 * Must match the exact structure of the English translations
 */
export const it: TranslationStructure = {
  tabs: {
    // Tab navigation labels
    inbox: 'Posta',
    sessions: 'Sessioni',
    settings: 'Impostazioni',
    closeOthers: 'Chiudi le altre',
    closeAll: 'Chiudi tutto',
  },

  inbox: {
    // Inbox screen
    emptyTitle: 'Posta vuota',
    emptyDescription: 'Connettiti con amici per iniziare a condividere sessioni',
    updates: 'Aggiornamenti',
  },

  common: {
    // Simple string constants
    cancel: 'Annulla',
    authenticate: 'Autentica',
    save: 'Salva',
    error: 'Errore',
    success: 'Successo',
    ok: 'OK',
    continue: 'Continua',
    back: 'Indietro',
    create: 'Crea',
    rename: 'Rinomina',
    reset: 'Ripristina',
    logout: 'Esci',
    yes: 'Sì',
    no: 'No',
    discard: 'Scarta',
    version: 'Versione',
    copied: 'Copiato',
    copy: 'Copia',
    scanning: 'Scansione...',
    urlPlaceholder: 'https://esempio.com',
    home: 'Home',
    message: 'Messaggio',
    files: 'File',
    fileViewer: 'Visualizzatore file',
    loading: 'Caricamento...',
    retry: 'Riprova',
    delete: 'Elimina',
    optional: 'opzionale',
    saveAs: 'Salva con nome',
  },

  profile: {
    userProfile: 'Profilo utente',
    details: 'Dettagli',
    firstName: 'Nome',
    lastName: 'Cognome',
    username: 'Nome utente',
    status: 'Stato',
  },

  status: {
    connected: 'connesso',
    connecting: 'connessione in corso',
    disconnected: 'disconnesso',
    error: 'errore',
    authError: 'sessione scaduta, disconnessione...',
    online: 'online',
    offline: 'offline',
    lastSeen: ({ time }: { time: string }) => `visto l'ultima volta ${time}`,
    permissionRequired: 'permesso richiesto',
    recoveryFailed: 'recupero fallito',
    activeNow: 'Attivo ora',
    unknown: 'sconosciuto',
    machinesOnline: ({ count }: { count: number }) =>
      count === 0 ? 'nessuna macchina' : `${count} ${count === 1 ? 'macchina' : 'macchine'} online`,
  },

  time: {
    justNow: 'proprio ora',
    minutesAgo: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? 'minuto' : 'minuti'} fa`,
    hoursAgo: ({ count }: { count: number }) => `${count} ${count === 1 ? 'ora' : 'ore'} fa`,
  },

  connect: {
    restoreAccount: 'Ripristina account',
    enterSecretKey: 'Inserisci la chiave segreta',
    invalidSecretKey: 'Chiave segreta non valida. Controlla e riprova.',
    enterUrlManually: 'Inserisci URL manualmente',
    connectName: ({ name }: { name: string }) => `Connetti ${name}`,
    runCommandInTerminal: 'Esegui il seguente comando nel tuo terminale:',
  },

  restore: {
    enterSecretKeyInstruction: 'Inserisci la tua chiave segreta per ripristinare l\'accesso al tuo account.',
    secretKeyPlaceholder: 'XXXXX-XXXXX-XXXXX...',
    qrStep1: '1. Apri Free sul tuo dispositivo mobile',
    qrStep2: '2. Vai su Impostazioni → Account',
    qrStep3: '3. Tocca "Collega nuovo dispositivo"',
    qrStep4: '4. Scansiona questo codice QR',
    restoreWithSecretKeyInstead: 'Ripristina con chiave segreta',
  },

  support: {
    tierCoffee: 'Compagno di caffè',
    tierCoffeePrice: '¥12',
    tierCoffeePeriod: '/mese',
    tierCoffeeDescription: 'Un caffè per alimentare lo sviluppo',
    tierCoffeeFeature1: 'Nessun badge sponsor nell\'app',
    tierCoffeeFeature2: 'Accesso anticipato alle nuove funzionalità',
    tierBuilder: 'Costruttore',
    tierBuilderPrice: '¥38',
    tierBuilderPeriod: '/mese',
    tierBuilderDescription: 'Modella il futuro della programmazione insieme',
    tierBuilderFeature1: 'Tutti i vantaggi di Compagno di caffè',
    tierBuilderFeature2: 'Canale Discord esclusivo',
    tierBuilderFeature3: 'Q&A mensile 1 a 1',
    tierPioneer: 'Pioniere',
    tierPioneerPrice: '¥98',
    tierPioneerPeriod: '/mese',
    tierPioneerDescription: 'Un\'esperienza esclusiva per i pionieri',
    tierPioneerFeature1: 'Tutti i vantaggi di Costruttore',
    tierPioneerFeature2: 'Accesso anticipato alle funzionalità sperimentali',
    tierPioneerFeature3: 'Priorità per richieste personalizzate',
    tierPioneerFeature4: 'Consulenza tecnica dedicata',
    title: 'Supporto',
    thankYouTitle: 'Grazie',
    purchaseSuccess: ({ name }: { name: string }) => `Ora sei un「${name}」. Grazie per il tuo supporto!`,
    purchaseFailed: 'Acquisto fallito',
    unknownError: 'Errore sconosciuto, riprova',
    thankYouMessage: 'Grazie per il tuo supporto',
    thankYouDescription: 'Sei un prezioso Costruttore. Il tuo supporto alimenta la nostra innovazione continua.',
    supportDevelopment: 'Supporta lo sviluppo',
    supportDescription: 'Il tuo supporto alimenta la nostra innovazione continua. Scegli un piano adatto a te e modella il futuro della programmazione insieme.',
    recommended: 'Consigliato',
    processing: 'Elaborazione...',
    joinTier: ({ name, price, period }: { name: string; price: string; period: string }) => `Unisciti a ${name} · ${price}${period}`,
    cancellableSecurePayment: 'Cancella in qualsiasi momento · Pagamento sicuro',
  },

  settings: {
    title: 'Impostazioni',
    connectedAccounts: 'Account collegati',
    connectAccount: 'Collega account',
    github: 'GitHub',
    machines: 'Macchine',
    features: 'Funzionalità',
    social: 'Social',
    account: 'Account',
    accountSubtitle: 'Gestisci i dettagli del tuo account',
    appearance: 'Aspetto',
    appearanceSubtitle: "Personalizza l'aspetto dell'app",
    permissions: 'Permissions',
    permissionsSubtitle: 'See what each permission is used for and manage access',
    featuresTitle: 'Funzionalità',
    featuresSubtitle: "Abilita o disabilita le funzionalità dell'app",
    focusAudio: 'Focus Audio',
    developer: 'Sviluppatore',
    exitDeveloperMode: 'Esci dalla modalità sviluppatore',
    developerTools: 'Strumenti sviluppatore',
    about: 'Informazioni',
    aboutFooter:
      'Free Coder è un client mobile per Codex e Claude Code. È completamente cifrato end-to-end e il tuo account è memorizzato solo sul tuo dispositivo. Non affiliato con Anthropic.',
    whatsNew: 'Novità',
    whatsNewSubtitle: 'Scopri gli ultimi aggiornamenti e miglioramenti',
    reportIssue: 'Segnala un problema',
    privacyPolicy: 'Informativa sulla privacy',
    termsOfService: 'Termini di servizio',
    eula: 'EULA',
    scanQrCodeToAuthenticate: 'Scansiona il codice QR per autenticarti',
    githubConnected: ({ login }: { login: string }) => `Connesso come @${login}`,
    connectGithubAccount: 'Collega il tuo account GitHub',
    claudeAuthSuccess: 'Connesso a Claude con successo',
    exchangingTokens: 'Scambio dei token...',
    usage: 'Utilizzo',
    usageSubtitle: 'Vedi il tuo utilizzo API e i costi',
    supportUs: 'Unisciti a noi',
    supportUsSubtitlePro: 'Sei un Costruttore 🎉',
    supportUsSubtitle: 'Fai parte del futuro',

    // Dynamic settings messages
    accountConnected: ({ service }: { service: string }) => `Account ${service} collegato`,
    machineStatus: ({ name, status }: { name: string; status: 'online' | 'offline' }) =>
      `${name} è ${status === 'online' ? 'online' : 'offline'}`,
    featureToggled: ({ feature, enabled }: { feature: string; enabled: boolean }) =>
      `${feature} ${enabled ? 'abilitata' : 'disabilitata'}`,
  },

  focusAudio: {
    pageTitle: 'Focus Audio',
    description:
      'Play an audible ambient loop while you work. When enabled, it can keep playing after Free moves to the background.',
    enable: 'Play Focus Audio',
    enabledState: 'Playing in a loop until you turn it off',
    disabledState: 'Off',
    sound: 'Sound',
    soundFooter: 'Choose the ambient noise profile you want to hear while Focus Audio is active.',
    soundFooterDisabled: 'You can choose a sound now and start playback whenever you are ready.',
    selectedSound: 'Selected',
    volume: 'Volume',
    volumeFooter: 'Set the playback level you want before leaving the app. 0% mutes the sound.',
    volumeHint: 'Set this to 0% if you want to mute Focus Audio without turning it off.',
    volumePercent: ({ percent }: { percent: number }) => `${percent}%`,
    mixWithOthers: 'Mix With Other Audio',
    mixWithOthersSubtitle: 'Let music, podcasts, or other apps keep playing at the same time.',
    mixWithOthersFooter:
      'Turn this off only if you want Focus Audio to take over the audio session.',
    settingsSubtitleEnabled: ({ sound }: { sound: string }) => `On · ${sound}`,
    settingsSubtitleDisabled: 'Audible background ambience',
    homeBackgroundPlaybackCompactEnabled: 'background playback',
  },

  backgroundReconnect: {
    promptTitle: 'Enable Background Reconnect',
    promptMessage:
      'Allow Free to use silent notifications to restore live sessions while the app is in the background.',
    blockedTitle: 'Turn On Background Reconnect',
    blockedMessage:
      'Notifications are currently blocked for Free. Open system settings to allow background reconnect.',
  },

  permissions: {
    pageDescription:
      'Turn on only the permissions you want. Free asks for access only when a feature needs it, and this page explains how each permission is used.',
    browserTitle: 'Browser Permissions',
    browserMessage:
      'On web, permissions are managed by your browser when a feature asks for them. Use your browser site settings to review or change access.',
    recommendedTitle: 'Live Sessions & Voice',
    recommendedFooter:
      'These permissions support reconnect, voice input, and real-time features. Free asks only when a related feature needs them.',
    optionalTitle: 'Media & Device Access',
    optionalFooter:
      'These permissions are only used when you choose media or QR-based linking flows yourself.',
    whyLabel: 'Why we ask',
    minimizeLabel: 'How we minimize access',
    statusAllowed: 'Allowed',
    statusLimited: 'Limited',
    statusNotAsked: 'Not asked',
    statusBlocked: 'Blocked',
    statusUnavailable: 'Unavailable',
    actionAllow: 'Allow Access',
    actionManage: 'Open Settings',
    notificationsTitle: 'Notifications',
    notificationsPurpose:
      'Used for important alerts and background reconnect, so live sessions can recover after the app has been in the background.',
    notificationsMinimize:
      'We use silent notifications for reconnect only when needed. We do not keep sending background reconnect notifications continuously.',
    microphoneTitle: 'Microphone',
    microphonePurpose: 'Needed for voice conversations and speech input.',
    microphoneMinimize:
      'Audio is accessed only while you are actively using voice features. Free does not record in the background.',
    speechTitle: 'Speech Recognition',
    speechPurpose: 'Needed to turn your speech into text when you use voice input.',
    speechMinimize:
      'Speech recognition runs only when you start dictation. It is not used for normal typing or in the background.',
    photosTitle: 'Photos',
    photosPurpose: 'Needed when you choose an image from your library to attach to a session.',
    photosMinimize:
      'Free only accesses photos you explicitly select. We do not scan your library in the background.',
    cameraTitle: 'Camera',
    cameraPurpose: 'Needed for QR code scanning when you link a device or connect a terminal.',
    cameraMinimize:
      'The camera is used only while the scanner is open, and only for the QR linking flow you start yourself.',
  },

  settingsAppearance: {
    // Appearance settings screen
    theme: 'Tema',
    themeDescription: 'Scegli lo schema di colori preferito',
    themeOptions: {
      adaptive: 'Adattivo',
      light: 'Chiaro',
      dark: 'Scuro',
    },
    themeDescriptions: {
      adaptive: 'Segui le impostazioni di sistema',
      light: 'Usa sempre il tema chiaro',
      dark: 'Usa sempre il tema scuro',
    },
    display: 'Schermo',
    displayDescription: 'Controlla layout e spaziatura',
    inlineToolCalls: 'Chiamate strumenti inline',
    inlineToolCallsDescription:
      'Mostra le chiamate agli strumenti direttamente nei messaggi di chat',
    expandTodoLists: 'Espandi liste di attività',
    expandTodoListsDescription: 'Mostra tutte le attività invece dei soli cambiamenti',
    showLineNumbersInDiffs: 'Mostra numeri di riga nelle differenze',
    showLineNumbersInDiffsDescription: 'Mostra i numeri di riga nei diff del codice',
    showLineNumbersInToolViews: 'Mostra numeri di riga nelle viste strumenti',
    showLineNumbersInToolViewsDescription: 'Mostra i numeri di riga nei diff delle viste strumenti',
    wrapLinesInDiffs: 'A capo nelle differenze',
    wrapLinesInDiffsDescription:
      'A capo delle righe lunghe invece dello scorrimento orizzontale nelle viste diff',
    alwaysShowContextSize: 'Mostra sempre dimensione contesto',
    alwaysShowContextSizeDescription:
      "Mostra l'uso del contesto anche quando non è vicino al limite",
    avatarStyle: 'Stile avatar',
    avatarStyleDescription: "Scegli l'aspetto dell'avatar di sessione",
    avatarOptions: {
      pixelated: 'Pixelato',
      gradient: 'Gradiente',
      brutalist: 'Brutalista',
    },
    showFlavorIcons: 'Mostra icone provider IA',
    showFlavorIconsDescription: 'Mostra le icone del provider IA sugli avatar di sessione',
    compactSessionView: 'Vista sessioni compatta',
    compactSessionViewDescription: 'Mostra le sessioni attive in un layout più compatto',
  },

  settingsFeatures: {
    // Features settings screen
    experiments: 'Esperimenti',
    experimentsDescription:
      'Abilita funzionalità sperimentali ancora in sviluppo. Queste funzionalità possono essere instabili o cambiare senza preavviso.',
    experimentalFeatures: 'Funzionalità sperimentali',
    experimentalFeaturesEnabled: 'Funzionalità sperimentali abilitate',
    experimentalFeaturesDisabled: 'Usando solo funzionalità stabili',
    webFeatures: 'Funzionalità web',
    webFeaturesDescription: "Funzionalità disponibili solo nella versione web dell'app.",
    enterToSend: 'Invio con Enter',
    enterToSendEnabled: 'Premi Invio per inviare (Maiusc+Invio per una nuova riga)',
    enterToSendDisabled: 'Invio inserisce una nuova riga',
    commandPalette: 'Palette comandi',
    commandPaletteEnabled: 'Premi ⌘K per aprire',
    commandPaletteDisabled: 'Accesso rapido ai comandi disabilitato',
    markdownCopyV2: 'Markdown Copy v2',
    markdownCopyV2Subtitle: 'Pressione lunga apre la finestra di copia',
    hideInactiveSessions: 'Nascondi sessioni inattive',
    hideInactiveSessionsSubtitle: 'Mostra solo le chat attive nella tua lista',
    enhancedSessionWizard: 'Wizard sessione avanzato',
    enhancedSessionWizardEnabled: 'Avvio sessioni con profili attivo',
    enhancedSessionWizardDisabled: 'Usando avvio sessioni standard',

},

  errors: {
    networkError: 'Si è verificato un errore di rete',
    serverError: 'Si è verificato un errore del server',
    unknownError: 'Si è verificato un errore sconosciuto',
    connectionTimeout: 'Connessione scaduta',
    authenticationFailed: 'Autenticazione non riuscita',
    permissionDenied: 'Permesso negato',
    fileNotFound: 'File non trovato',
    invalidFormat: 'Formato non valido',
    operationFailed: 'Operazione non riuscita',
    tryAgain: 'Per favore riprova',
    contactSupport: "Contatta l'assistenza se il problema persiste",
    sessionNotFound: 'Sessione non trovata',
    voiceSessionFailed: 'Avvio della sessione vocale non riuscito',
    voiceServiceUnavailable: 'Il servizio vocale non è temporaneamente disponibile',
    voiceNotConfigured: 'Voice feature is not configured. Please contact support.',
    voiceNotInitialized:
      'Voice service failed to initialize. Please restart the app and try again.',
    voiceMicPermissionWeb:
      'Microphone access is required for voice. Please allow microphone permission in your browser settings.',
    voiceTokenRejected: 'Voice service is not available on this server.',
    oauthInitializationFailed: 'Impossibile inizializzare il flusso OAuth',
    tokenStorageFailed: 'Impossibile salvare i token di autenticazione',
    oauthStateMismatch: 'Convalida di sicurezza non riuscita. Riprova',
    tokenExchangeFailed: 'Impossibile scambiare il codice di autorizzazione',
    oauthAuthorizationDenied: 'Autorizzazione negata',
    webViewLoadFailed: 'Impossibile caricare la pagina di autenticazione',
    failedToLoadProfile: 'Impossibile caricare il profilo utente',
    userNotFound: 'Utente non trovato',
    sessionDeleted: 'La sessione è stata eliminata',
    sessionDeletedDescription: 'Questa sessione è stata rimossa definitivamente',

    // Error functions with context
    fieldError: ({ field, reason }: { field: string; reason: string }) => `${field}: ${reason}`,
    validationError: ({ field, min, max }: { field: string; min: number; max: number }) =>
      `${field} deve essere tra ${min} e ${max}`,
    retryIn: ({ seconds }: { seconds: number }) =>
      `Riprova tra ${seconds} ${seconds === 1 ? 'secondo' : 'secondi'}`,
    errorWithCode: ({ message, code }: { message: string; code: number | string }) =>
      `${message} (Errore ${code})`,
    disconnectServiceFailed: ({ service }: { service: string }) =>
      `Impossibile disconnettere ${service}`,
    connectServiceFailed: ({ service }: { service: string }) =>
      `Impossibile connettere ${service}. Riprova.`,
    failedToLoadFriends: 'Impossibile caricare la lista amici',
    failedToAcceptRequest: 'Impossibile accettare la richiesta di amicizia',
    failedToRejectRequest: 'Impossibile rifiutare la richiesta di amicizia',
    failedToRemoveFriend: "Impossibile rimuovere l'amico",
    searchFailed: 'Ricerca non riuscita. Riprova.',
    failedToSendRequest: 'Impossibile inviare la richiesta di amicizia',
  },

  newSession: {
    // Used by new-session screen and launch flows
    title: 'Avvia nuova sessione',
    noMachinesFound: 'Nessuna macchina trovata. Avvia prima una sessione Free sul tuo computer.',
    allMachinesOffline: 'Tutte le macchine sembrano offline',
    machineDetails: 'Visualizza dettagli macchina →',
    directoryDoesNotExist: 'Directory non trovata',
    createDirectoryConfirm: ({ directory }: { directory: string }) =>
      `La directory ${directory} non esiste. Vuoi crearla?`,
    sessionStarted: 'Sessione avviata',
    sessionStartedMessage: 'La sessione è stata avviata con successo.',
    sessionSpawningFailed: 'Avvio sessione non riuscito - nessun ID sessione restituito.',
    startingSession: 'Avvio sessione...',
    startNewSessionInFolder: 'Nuova sessione qui',
    failedToStart:
      'Impossibile avviare la sessione. Assicurati che il daemon sia in esecuzione sulla macchina di destinazione.',
    sessionTimeout:
      'Avvio sessione scaduto. La macchina potrebbe essere lenta o il daemon potrebbe non rispondere.',
    notConnectedToServer: 'Non connesso al server. Controlla la tua connessione Internet.',
    noMachineSelected: 'Seleziona una macchina per avviare la sessione',
    noPathSelected: 'Seleziona una directory in cui avviare la sessione',
    sessionType: {
      title: 'Tipo di sessione',
      simple: 'Semplice',
      worktree: 'Worktree',
      comingSoon: 'In arrivo',
    },
    worktree: {
      creating: ({ name }: { name: string }) => `Creazione worktree '${name}'...`,
      notGitRepo: 'Le worktree richiedono un repository git',
      failed: ({ error }: { error: string }) => `Impossibile creare la worktree: ${error}`,
      success: 'Worktree creata con successo',
      branchConfigureTitle: 'Worktree branch',
      branchModeAuto: 'Auto',
      branchModeExisting: 'Esistente',
      branchModeNew: 'Nuova',
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
    inputPlaceholder: 'Su cosa vorresti lavorare?',
    capabilityDiscoveryNotice:
      'Invia il tuo primo messaggio per caricare modalità, modelli e comandi.',
  },

  agentPicker: {
    headerTitle: 'Seleziona agente',
    heroEyebrow: 'Selettore implementazione',
    heroTitle: 'Scegli il runtime con cui vuoi iniziare.',
    heroDescription:
      'Ogni opzione qui sotto viene scoperta dalle implementazioni registrate sulla macchina selezionata. Le voci classiche e ACP sono mantenute separate di proposito.',
    experimentalSection: 'Sperimentale',
    experimentalCaption: "Agenti opzionali dietro l'impostazione degli esperimenti.",
    noAgentsTitle: 'Nessun agente disponibile',
    noAgentsDescription: 'Questa macchina non ha segnalato alcuna implementazione eseguibile.',
    tagAcp: 'ACP',
    tagClassic: 'Classico',
    tagAnthropic: 'Anthropic',
    tagOpenAI: 'OpenAI',
    tagGoogle: 'Google',
    tagTerminal: 'Terminale',
    tagExperimental: 'Sperimentale',
  },

  machinePicker: {
    headerTitle: 'Seleziona macchina',
    noMachinesAvailable: 'Nessuna macchina disponibile',
    online: 'online',
    offline: 'offline',
    searchPlaceholder: 'Digita per filtrare le macchine...',
    recentSection: 'Macchine recenti',
    favoritesSection: 'Macchine preferite',
    allSection: 'Tutti i dispositivi',
  },

  pathPicker: {
    headerTitle: 'Seleziona percorso',
    noMachineSelected: 'Nessuna macchina selezionata',
    enterPath: 'Inserisci percorso',
    enterPathPlaceholder: 'Inserisci percorso (es. /home/user/projects)',
    recentPaths: 'Percorsi recenti',
    suggestedPaths: 'Percorsi suggeriti',
    browse: 'Sfoglia',
    browseError: 'Impossibile caricare la directory',
    emptyDirectory: 'Nessuna sottodirectory',
  },

  sessionHistory: {
    // Used by session history screen
    title: 'Cronologia sessioni',
    empty: 'Nessuna sessione trovata',
    today: 'Oggi',
    yesterday: 'Ieri',
    daysAgo: ({ count }: { count: number }) => `${count} ${count === 1 ? 'giorno' : 'giorni'} fa`,
    viewAll: 'Visualizza tutte le sessioni',
  },

  session: {
    inputPlaceholder: 'Scrivi un messaggio ...',
    sendFailed: 'Invio fallito. Tocca per riprovare.',
    sendBlockedServerDisconnected: 'Server disconnesso, impossibile inviare il messaggio',
    sendBlockedDaemonOffline: 'Sessione offline, impossibile inviare il messaggio',
    addImage: 'Aggiungi immagine',
    pickLatestPhoto: 'Ultima foto',
    chooseFromLibrary: 'Scegli dalla libreria',
    latestPhotoUnavailable:
      'Impossibile caricare una foto. Consenti l\'accesso alla libreria o aggiungi foto.',
  },

  commandPalette: {
    placeholder: 'Digita un comando o cerca...',
  },

  server: {
    // Used by Server Configuration screen (app/(app)/server.tsx)
    serverConfiguration: 'Configurazione server',
    enterServerUrl: 'Inserisci un URL del server',
    notValidFreeServer: 'Non è un Free Server valido',
    changeServer: 'Cambia server',
    continueWithServer: 'Continuare con questo server?',
    resetToDefault: 'Ripristina predefinito',
    resetServerDefault: 'Ripristinare il server predefinito?',
    validating: 'Verifica...',
    validatingServer: 'Verifica del server...',
    serverReturnedError: 'Il server ha restituito un errore',
    failedToConnectToServer: 'Impossibile connettersi al server',
    currentlyUsingCustomServer: 'Attualmente si usa un server personalizzato',
    devIgnoringProductionServer:
      'La modalità di sviluppo sta ignorando l’URL del server di produzione e sta usando invece il server locale di sviluppo.',
    customServerUrlLabel: 'URL server personalizzato',
    advancedFeatureFooter:
      'Questa è una funzionalità avanzata. Cambia il server solo se sai cosa stai facendo. Dovrai disconnetterti e accedere di nuovo dopo aver cambiato server.',
  },

  sessionInfo: {
    // Used by Session Info screen (app/(app)/session/[id]/info.tsx)
    killSession: 'Termina sessione',
    killSessionConfirm: 'Sei sicuro di voler terminare questa sessione?',
    archiveSession: 'Archivia sessione',
    archiveSessionConfirm: 'Sei sicuro di voler archiviare questa sessione?',
    freeSessionIdCopied: 'ID sessione Free copiato negli appunti',
    failedToCopySessionId: "Impossibile copiare l'ID sessione Free",
    freeSessionId: 'ID sessione Free',
    agentSessionId: 'ID sessione Claude Code',
    agentSessionIdCopied: 'ID sessione Claude Code copiato negli appunti',
    aiProvider: 'Provider IA',
    failedToCopyAgentSessionId: "Impossibile copiare l'ID sessione Claude Code",
    metadataCopied: 'Metadati copiati negli appunti',
    failedToCopyMetadata: 'Impossibile copiare i metadati',
    failedToKillSession: 'Impossibile terminare la sessione',
    failedToArchiveSession: 'Impossibile archiviare la sessione',
    connectionStatus: 'Stato connessione',
    created: 'Creato',
    lastUpdated: 'Ultimo aggiornamento',
    sequence: 'Sequenza',
    quickActions: 'Azioni rapide',
    viewMachine: 'Visualizza macchina',
    viewMachineSubtitle: 'Visualizza dettagli e sessioni della macchina',
    viewUsage: 'Visualizza utilizzo',
    viewUsageSubtitle: 'Visualizza il dettaglio di token e costo di questa sessione',
    killSessionSubtitle: 'Termina immediatamente la sessione',
    archiveSessionSubtitle: 'Archivia questa sessione e fermala',
    recoveryFailedArchiveSubtitle: 'Questa sessione non è riuscita a recuperarsi dopo un crash',
    metadata: 'Metadati',
    host: 'Host',
    path: 'Percorso',
    operatingSystem: 'Sistema operativo',
    processId: 'ID processo',
    freeHome: 'Free Home',
    copyMetadata: 'Copia metadati',
    agentState: 'Stato agente',
    controlledByUser: "Controllato dall'utente",
    pendingRequests: 'Richieste in sospeso',
    activity: 'Attività',
    thinking: 'Pensando',
    thinkingSince: 'Pensando da',
    cliVersion: 'Versione CLI',
    cliVersionOutdated: 'Aggiornamento CLI richiesto',
    cliVersionOutdatedMessage: ({
      currentVersion,
      requiredVersion,
    }: {
      currentVersion: string;
      requiredVersion: string;
    }) => `Versione ${currentVersion} installata. Aggiorna a ${requiredVersion} o successiva`,
    updateCliInstructions:
      'Esegui npm install -g @saaskit-dev/free',
    restartAgent: 'Riavvio forzato agente',
    restartAgentConfirm: "Questo terminerà il processo dell'agente attuale e ne avvierà uno nuovo. La sessione e la cronologia della conversazione verranno preservate.",
    restartAgentSubtitle: "Termina e riavvia il processo dell'agente",
    restartAgentSuccess: "Il processo dell'agente si sta riavviando.",
    failedToRestartAgent: "Impossibile riavviare l'agente",
    deleteSession: 'Elimina sessione',
    deleteSessionSubtitle: 'Rimuovi definitivamente questa sessione',
    deleteSessionConfirm: 'Eliminare definitivamente la sessione?',
    deleteSessionWarning:
      'Questa azione non può essere annullata. Tutti i messaggi e i dati associati a questa sessione verranno eliminati definitivamente.',
    failedToDeleteSession: 'Impossibile eliminare la sessione',
    sessionDeleted: 'Sessione eliminata con successo',
    clearCache: 'Svuota cache',
    clearCacheSubtitle: 'Svuota i dati della cache locale per questa sessione',
    clearCacheConfirm: 'Svuotare tutti i dati della cache per questa sessione? I messaggi verranno recuperati nuovamente dal server.',
    clearCacheSuccess: 'Cache svuotata con successo',
    clearCacheFailed: 'Svuotamento cache fallito',
  },

  components: {
    emptyMainScreen: {
      // Used by EmptyMainScreen component
      readyToCode: 'Pronto a programmare?',
      installCli: 'Installa la CLI Free',
      runIt: 'Avviala',
      scanQrCode: 'Scansiona il codice QR',
      openCamera: 'Apri fotocamera',
    },
  },

  agentInput: {
    permissionMode: {
      title: 'MODALITÀ PERMESSI',
      readOnly: 'Solo lettura',
      acceptEdits: 'Accetta modifiche',
      yolo: 'YOLO',
      badgeReadOnly: 'Solo lettura',
      badgeAcceptEdits: 'Accetta modifiche',
      badgeYolo: 'YOLO',
    },
    agentTitle: 'Agente',
    agentModeTitle: 'Modalità agente',
    experimentalSection: 'Sperimentale',
    agent: {
      claude: 'Claude',
      codex: 'Codex',
      gemini: 'Gemini',
      opencode: 'OpenCode',
    },
    model: {
      title: 'MODELLO',
      configureInCli: 'Configura i modelli nelle impostazioni CLI',
    },
    codexModel: {
      title: 'MODELLO CODEX',
      gpt5CodexLow: 'gpt-5-codex basso',
      gpt5CodexMedium: 'gpt-5-codex medio',
      gpt5CodexHigh: 'gpt-5-codex alto',
      gpt5Minimal: 'GPT-5 Minimo',
      gpt5Low: 'GPT-5 Basso',
      gpt5Medium: 'GPT-5 Medio',
      gpt5High: 'GPT-5 Alto',
    },
    context: {
      remaining: ({ percent }: { percent: number }) => `${percent}% restante`,
    },
    suggestion: {
      fileLabel: 'FILE',
      folderLabel: 'CARTELLA',
    },
    noMachinesAvailable: 'Nessuna macchina',
    abortConfirmTitle: 'Interrompere la risposta corrente?',
    abortConfirmMessage: "L'agente smetterà di lavorare su questa risposta.",
    abortConfirmAction: 'Interrompi',
    abortTimedOut:
      'Richiesta di interruzione scaduta. Controlla la connessione e riprova.',
    speechInput: {
      recording: 'In ascolto...',
      permissionTitle: 'Accesso al microfono richiesto',
      permissionMessage: "Consenti l'accesso al microfono e al riconoscimento vocale nelle impostazioni di sistema.",
      permissionBrowserMessage:
        "Consenti l'accesso al microfono e al riconoscimento vocale nelle impostazioni del sito del browser.",
      permissionCancel: 'Annulla',
      permissionOpenSettings: 'Apri impostazioni',
      errorTitle: 'Riconoscimento vocale non riuscito',
      errorMessage: ({ error }: { error: string }) => `Impossibile avviare il riconoscimento vocale (${error}).`,
      unsupportedTitle: 'Input vocale non disponibile',
      unsupportedMessage:
        'Questo browser non supporta ancora l’input vocale. Prova un browser supportato o digita il messaggio.',
      languageUnavailableTitle: 'Pacchetto lingua non installato',
      languageUnavailableMessage: 'Il pacchetto di riconoscimento vocale per la lingua selezionata non è stato scaricato. Apri le impostazioni per installarlo o passa all\'inglese.',
      languageUnavailableCancel: 'Annulla',
      languageUnavailableOpenSettings: 'Apri impostazioni',
      languageUnavailableUseEnglish: "Usa l'inglese",
    },
  },

  machineLauncher: {
    showLess: 'Mostra meno',
    showAll: ({ count }: { count: number }) => `Mostra tutto (${count} percorsi)`,
    enterCustomPath: 'Inserisci percorso personalizzato',
    offlineUnableToSpawn: 'Impossibile avviare una nuova sessione, offline',
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
      description: 'Descrizione',
      inputParams: 'Parametri di input',
      output: 'Output',
      error: 'Errore',
      completed: 'Strumento completato con successo',
      noOutput: 'Nessun output prodotto',
      running: 'Strumento in esecuzione...',
      rawJsonDevMode: 'JSON grezzo (Modalità sviluppatore)',
    },
    taskView: {
      initializing: 'Inizializzazione agente...',
      moreTools: ({ count }: { count: number }) =>
        `+${count} altri ${plural({ count, singular: 'strumento', plural: 'strumenti' })}`,
    },
    askUserQuestion: {
      submit: 'Invia risposta',
      multipleQuestions: ({ count }: { count: number }) =>
        `${count} ${plural({ count, singular: 'domanda', plural: 'domande' })}`,
      other: 'Altro',
      otherDescription: 'Scrivi la tua risposta',
      otherPlaceholder: 'Scrivi la tua risposta...',
    },
    multiEdit: {
      editNumber: ({ index, total }: { index: number; total: number }) =>
        `Modifica ${index} di ${total}`,
      replaceAll: 'Sostituisci tutto',
    },
    names: {
      task: 'Attività',
      terminal: 'Terminale',
      searchFiles: 'Cerca file',
      search: 'Cerca',
      searchContent: 'Cerca contenuto',
      listFiles: 'Elenca file',
      planProposal: 'Proposta di piano',
      readFile: 'Leggi file',
      editFile: 'Modifica file',
      writeFile: 'Scrivi file',
      fetchUrl: 'Recupera URL',
      readNotebook: 'Leggi notebook',
      editNotebook: 'Modifica notebook',
      todoList: 'Elenco attività',
      webSearch: 'Ricerca web',
      toolSearch: 'Ricerca strumenti',
      reasoning: 'Ragionamento',
      applyChanges: 'Aggiorna file',
      viewDiff: 'Modifiche file attuali',
      question: 'Domanda',
    },
    desc: {
      terminalCmd: ({ cmd }: { cmd: string }) => `Terminale(cmd: ${cmd})`,
      searchPattern: ({ pattern }: { pattern: string }) => `Cerca(pattern: ${pattern})`,
      searchPath: ({ basename }: { basename: string }) => `Cerca(path: ${basename})`,
      fetchUrlHost: ({ host }: { host: string }) => `Recupera URL(url: ${host})`,
      editNotebookMode: ({ path, mode }: { path: string; mode: string }) =>
        `Modifica notebook(file: ${path}, mode: ${mode})`,
      todoListCount: ({ count }: { count: number }) => `Elenco attività(count: ${count})`,
      webSearchQuery: ({ query }: { query: string }) => `Ricerca web(query: ${query})`,
      grepPattern: ({ pattern }: { pattern: string }) => `grep(pattern: ${pattern})`,
      multiEditEdits: ({ path, count }: { path: string; count: number }) =>
        `${path} (${count} modifiche)`,
      readingFile: ({ file }: { file: string }) => `Leggendo ${file}`,
      writingFile: ({ file }: { file: string }) => `Scrivendo ${file}`,
      modifyingFile: ({ file }: { file: string }) => `Modificando ${file}`,
      modifyingFiles: ({ count }: { count: number }) => `Modificando ${count} file`,
      modifyingMultipleFiles: ({ file, count }: { file: string; count: number }) =>
        `${file} e altri ${count}`,
      showingDiff: 'Mostrando modifiche',
    },
  },

  files: {
    searchPlaceholder: 'Cerca file...',
    detachedHead: 'HEAD scollegato',
    summary: ({ staged, unstaged }: { staged: number; unstaged: number }) =>
      `${staged} in stage • ${unstaged} non in stage`,
    notRepo: 'Non è un repository git',
    notUnderGit: 'Questa directory non è sotto controllo versione git',
    searching: 'Ricerca file...',
    noFilesFound: 'Nessun file trovato',
    noFilesInProject: 'Nessun file nel progetto',
    tryDifferentTerm: 'Prova un termine di ricerca diverso',
    searchResults: ({ count }: { count: number }) => `Risultati ricerca (${count})`,
    projectRoot: 'Radice progetto',
    stagedChanges: ({ count }: { count: number }) => `Modifiche in stage (${count})`,
    unstagedChanges: ({ count }: { count: number }) => `Modifiche non in stage (${count})`,
    // File viewer strings
    loadingFile: ({ fileName }: { fileName: string }) => `Caricamento ${fileName}...`,
    binaryFile: 'File binario',
    cannotDisplayBinary: 'Impossibile mostrare il contenuto del file binario',
    tapImageToZoom: "Tocca l'immagine per ingrandirla",
    diff: 'Diff',
    file: 'File',
    fileEmpty: 'File vuoto',
    noChanges: 'Nessuna modifica da mostrare',
    failedToDecodeContent: 'Impossibile decodificare il contenuto del file',
    failedToReadFile: 'Impossibile leggere il file',
    failedToLoadFile: 'Impossibile caricare il file',
    pathCopied: 'Percorso copiato',
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
    brokenSymlink: 'This symbolic link points to a missing target',
    specialFile: 'This special file type cannot be previewed',
    permissionDenied: 'Permission denied for this file or folder',
    directoryCannotPreview: 'Directories cannot be previewed as files',
    imageTooLargeToPreview: 'This image is too large to preview inline',
    largeFilePreviewTruncated: 'Large file: only the first portion is shown',
    symlinkTo: ({ target }: { target: string }) => `Symlink to ${target}`,
    download: 'Scarica',
    downloadFolder: 'Scarica come ZIP',
    delete: 'Elimina',
    deleteFileConfirm: ({ name }: { name: string }) => `Delete "${name}"? This cannot be undone.`,
    deleteFolderConfirm: ({ name }: { name: string }) => `Delete folder "${name}" and all its contents? This cannot be undone.`,
    deleteSuccess: 'Eliminato correttamente',
    deleteError: 'Eliminazione non riuscita',
    downloadError: 'Download del file non riuscito',
    fileTooLargeToDownload: 'Il file è troppo grande per il download (max 10 MB)',
    downloadFolderError: 'Download della cartella non riuscito',
    preparingDownload: 'Preparazione download...',
    actions: 'Azioni',
  },

  settingsAccount: {
    // Account settings screen
    accountInformation: 'Informazioni account',
    status: 'Stato',
    statusActive: 'Attivo',
    statusNotAuthenticated: 'Non autenticato',
    anonymousId: 'ID anonimo',
    publicId: 'ID pubblico',
    notAvailable: 'Non disponibile',
    linkNewDevice: 'Collega nuovo dispositivo',
    linkNewDeviceSubtitle: 'Scansiona il codice QR per collegare il dispositivo',
    profile: 'Profilo',
    name: 'Nome',
    github: 'GitHub',
    tapToDisconnect: 'Tocca per disconnettere',
    server: 'Server',
    backup: 'Backup',
    backupDescription:
      "La tua chiave segreta è l'unico modo per recuperare l'account. Salvala in un posto sicuro come un gestore di password.",
    secretKey: 'Chiave segreta',
    tapToReveal: 'Tocca per mostrare',
    tapToHide: 'Tocca per nascondere',
    secretKeyLabel: 'CHIAVE SEGRETA (TOCCA PER COPIARE)',
    secretKeyCopied: 'Chiave segreta copiata negli appunti. Conservala in un luogo sicuro!',
    secretKeyCopyFailed: 'Impossibile copiare la chiave segreta',
    privacy: 'Privacy',
    privacyDescription:
      "Aiuta a migliorare l'app condividendo dati di utilizzo anonimi. Nessuna informazione personale viene raccolta.",
    analytics: 'Analytics',
    analyticsDisabled: 'Nessun dato condiviso',
    analyticsEnabled: 'I dati di utilizzo anonimi sono condivisi',
    dangerZone: 'Zona pericolosa',
    logout: 'Esci',
    logoutSubtitle: 'Disconnetti e cancella i dati locali',
    logoutConfirm:
      'Sei sicuro di voler uscire? Assicurati di aver fatto il backup della tua chiave segreta!',
  },

  settingsLanguage: {
    // Language settings screen
    title: 'Lingua',
    description:
      "Scegli la tua lingua preferita per l'interfaccia dell'app. Questo si sincronizza su tutti i tuoi dispositivi.",
    currentLanguage: 'Lingua attuale',
    automatic: 'Automatico',
    automaticSubtitle: 'Rileva dalle impostazioni del dispositivo',
    needsRestart: 'Lingua cambiata',
    needsRestartMessage: "L'app deve riavviarsi per applicare la nuova impostazione della lingua.",
    restartNow: 'Riavvia ora',
  },

  connectButton: {
    authenticate: 'Autentica terminale',
    authenticateWithUrlPaste: 'Autentica terminale incollando URL',
    pasteAuthUrl: "Incolla l'URL di autenticazione dal terminale",
  },

  updateBanner: {
    updateAvailable: 'Aggiornamento disponibile',
    pressToApply: "Premi per applicare l'aggiornamento",
    whatsNew: 'Novità',
    seeLatest: 'Vedi gli ultimi aggiornamenti e miglioramenti',
    nativeUpdateAvailable: 'Aggiornamento app disponibile',
    tapToUpdateAppStore: "Tocca per aggiornare nell'App Store",
    tapToUpdatePlayStore: 'Tocca per aggiornare nel Play Store',
  },

  changelog: {
    // Used by the changelog screen
    version: ({ version }: { version: number }) => `Versione ${version}`,
    noEntriesAvailable: 'Nessuna voce di changelog disponibile.',
  },

  terminal: {
    // Used by terminal connection screens
    webBrowserRequired: 'Browser web richiesto',
    webBrowserRequiredDescription:
      'I link di connessione del terminale possono essere aperti solo in un browser web per motivi di sicurezza. Usa lo scanner QR o apri questo link su un computer.',
    processingConnection: 'Elaborazione connessione...',
    invalidConnectionLink: 'Link di connessione non valido',
    invalidConnectionLinkDescription:
      "Il link di connessione è mancante o non valido. Controlla l'URL e riprova.",
    connectTerminal: 'Connetti terminale',
    terminalRequestDescription:
      'Un terminale richiede di connettersi al tuo account Free Coder. Questo consentirà al terminale di inviare e ricevere messaggi in modo sicuro.',
    connectionDetails: 'Dettagli connessione',
    publicKey: 'Chiave pubblica',
    encryption: 'Cifratura',
    endToEndEncrypted: 'Crittografia end-to-end',
    acceptConnection: 'Accetta connessione',
    createAccountAndAccept: 'Crea account e accetta',
    creatingAccount: 'Creazione account...',
    connecting: 'Connessione...',
    reject: 'Rifiuta',
    security: 'Sicurezza',
    securityFooter:
      'Questo link di connessione è stato elaborato in modo sicuro nel tuo browser e non è mai stato inviato a nessun server. I tuoi dati privati rimarranno sicuri e solo tu potrai decifrare i messaggi.',
    securityFooterDevice:
      'Questa connessione è stata elaborata in modo sicuro sul tuo dispositivo e non è mai stata inviata a nessun server. I tuoi dati privati rimarranno sicuri e solo tu potrai decifrare i messaggi.',
    clientSideProcessing: 'Elaborazione lato client',
    linkProcessedLocally: 'Link elaborato localmente nel browser',
    linkProcessedOnDevice: 'Link elaborato localmente sul dispositivo',
  },

  modals: {
    // Used across connect flows and settings
    authenticateTerminal: 'Autentica terminale',
    pasteUrlFromTerminal: "Incolla l'URL di autenticazione dal terminale",
    deviceLinkedSuccessfully: 'Dispositivo collegato con successo',
    terminalConnectedSuccessfully: 'Terminale collegato con successo',
    invalidAuthUrl: 'URL di autenticazione non valido',
    developerMode: 'Modalità sviluppatore',
    developerModeEnabled: 'Modalità sviluppatore attivata',
    developerModeDisabled: 'Modalità sviluppatore disattivata',
    disconnectGithub: 'Disconnetti GitHub',
    disconnectGithubConfirm: 'Sei sicuro di voler disconnettere il tuo account GitHub?',
    disconnectService: ({ service }: { service: string }) => `Disconnetti ${service}`,
    disconnectServiceConfirm: ({ service }: { service: string }) =>
      `Sei sicuro di voler disconnettere ${service} dal tuo account?`,
    disconnect: 'Disconnetti',
    failedToConnectTerminal: 'Impossibile connettere il terminale',
    cameraPermissionsRequiredToConnectTerminal:
      'Sono necessarie le autorizzazioni della fotocamera per connettere il terminale',
    failedToLinkDevice: 'Impossibile collegare il dispositivo',
    cameraPermissionsRequiredToScanQr:
      'Sono necessarie le autorizzazioni della fotocamera per scansionare i codici QR',
  },

  navigation: {
    // Navigation titles and screen headers
    connectTerminal: 'Connetti terminale',
    linkNewDevice: 'Collega nuovo dispositivo',
    restoreWithSecretKey: 'Ripristina con chiave segreta',
    whatsNew: 'Novità',
    friends: 'Amici',
    importExistingAgentSessions: 'Importa sessioni agente esistenti',
    connectTo: ({ name }: { name: string }) => `Connetti a ${name}`,
    developerTools: 'Strumenti per sviluppatori',
    listComponentsDemo: 'Demo dei componenti lista',
    typography: 'Tipografia',
    colors: 'Colori',
    toolViewsDemo: 'Demo delle viste strumenti',
    shimmerViewDemo: 'Demo vista shimmer',
    multiTextInput: 'Input testo multilinea',
  },

  welcome: {
    // Main welcome screen for unauthenticated users
    title: 'Client mobile di Codex e Claude Code',
    subtitle: 'Crittografia end-to-end e account memorizzato solo sul tuo dispositivo.',
    createAccount: 'Crea account',
    linkOrRestoreAccount: 'Collega o ripristina account',
    loginWithMobileApp: "Accedi con l'app mobile",
  },

  review: {
    // Used by utils/requestReview.ts
    enjoyingApp: "Ti piace l'app?",
    feedbackPrompt: 'Ci piacerebbe ricevere il tuo feedback!',
    yesILoveIt: 'Sì, mi piace!',
    notReally: 'Non proprio',
  },

  items: {
    // Used by Item component for copy toast
    copiedToClipboard: ({ label }: { label: string }) => `${label} copiato negli appunti`,
  },

  machineImport: {
    title: 'Import Existing Agent Sessions',
    browse: 'Browse existing agent chats',
    machineSummary: ({ count, imported }: { count: number; imported: number }) =>
      `Supports Claude · Codex · OpenCode. ${count} chats found, ${imported} imported.`,
    machineSummarySimple: 'Browse existing chats from supported agents.',
    machineSummaryCount: ({ count }: { count: number }) => `${count} existing chats available.`,
    onMachine: ({ machine }: { machine: string }) => `On ${machine}`,
    discoverableCount: ({ count }: { count: number }) => `${count} discoverable`,
    agentCount: ({ count }: { count: number }) => `${count} agents`,
    importedCount: ({ count }: { count: number }) => `${count} imported`,
    searchPlaceholder: 'Search title, path, or agent',
    agentLabel: 'Agent',
    statusLabel: 'Status',
    existingChats: 'Existing chats',
    showingCount: ({ shown, total }: { shown: number; total: number }) =>
      `Showing ${shown} of ${total}`,
    existing: 'Existing',
    imported: 'Imported',
    managed: 'Managed',
    open: 'Open',
    continueHere: 'Continue here',
    continueTitle: 'Continue here?',
    continueBody: ({ agent }: { agent: string }) =>
      `This will import the existing ${agent} chat into AgentBridge and continue it here.`,
    resumeFailedTitle: 'Could not restore session',
    resumeFailedBody: ({ agent }: { agent: string }) =>
      `This ${agent} session could not be restored right now. It may no longer exist, may be corrupted, or the current agent version may no longer support restoring it. Refresh and try again, or start a new session in the same directory.`,
    openImportedTitle: 'Open imported session',
    openImportedBody: 'This chat is already imported into AgentBridge.',
    prototypeTitle: 'Prototype only',
    prototypeBody: 'Actual ACP discovery/import is not wired yet.',
    directoryMissingTitle: 'Create directory?',
    directoryMissingBody: ({ directory }: { directory: string }) =>
      `The directory '${directory}' does not exist. Create it and continue?`,
    emptyTitle: 'No matching sessions',
    emptyBody: 'Try another filter or search term.',
    noticeLoading: 'Loading agent histories',
    noticeLoadFailed: 'Some agents could not be loaded',
    noticeUnsupported: 'History not available',
    noticeUpdated: 'Last refresh',
    loadingProgress: ({ loaded, total }: { loaded: number; total: number }) =>
      `Loading ${loaded}/${total}`,
    loadingAgents: ({ loaded, total, agents }: { loaded: number; total: number; agents: string }) =>
      `Loaded ${loaded} of ${total}. Still loading: ${agents}.`,
    partialFailure: ({ count, agents }: { count: number; agents: string }) =>
      `${count} agents could not be loaded: ${agents}.`,
    unsupportedAgents: ({ agents }: { agents: string }) => `${agents} do not expose session history.`,
    cachedAt: ({ time }: { time: string }) => `Updated ${time}`,
    loadMore: 'Load more sessions',
    filters: {
      allAgents: 'All agents',
      all: 'All',
      available: 'Available',
      imported: 'Imported',
    },
  },

  machine: {
    launchNewSessionInDirectory: 'Avvia nuova sessione nella directory',
    enterCustomPath: 'Inserisci percorso personalizzato',
    previousSessions: 'Sessioni precedenti (fino a 5 più recenti)',
    machineNotFound: 'Macchina non trovata',
    stopDaemonConfirmTitle: 'Fermare il daemon?',
    stopDaemonConfirmMessage: 'Non potrai creare nuove sessioni su questa macchina fino al riavvio del daemon. Le sessioni correnti rimarranno attive.',
    daemonStopped: 'Daemon fermato',
    failedToStopDaemon: 'Impossibile fermare il daemon. Potrebbe non essere in esecuzione.',
    renameMachine: 'Rinomina macchina',
    renameMachineMessage: 'Dai un nome personalizzato a questa macchina. Lascia vuoto per usare il nome host predefinito.',
    enterMachineName: 'Inserisci nome macchina',
    machineRenamed: 'Macchina rinominata con successo',
    createDirectoryTitle: 'Creare directory?',
    createDirectoryMessage: ({ directory }: { directory: string }) => `La directory '${directory}' non esiste. Vuoi crearla?`,
    failedToStartSession: 'Impossibile avviare la sessione. Assicurati che il daemon sia in esecuzione sulla macchina di destinazione.',
    offlineUnableToSpawn: 'Avvio disabilitato quando la macchina è offline',
    offlineHelp:
      "• Assicurati che il tuo computer sia online\n• Esegui `free daemon status` per diagnosticare\n• Stai usando l'ultima versione della CLI? Aggiorna con `npm install -g @saaskit-dev/free`",
    daemon: 'Demone',
    status: 'Stato',
    stopDaemon: 'Arresta daemon',
    lastKnownPid: 'Ultimo PID noto',
    lastKnownHttpPort: 'Ultima porta HTTP nota',
    startedAt: 'Avviato alle',
    cliVersion: 'Versione CLI',
    daemonStateVersion: 'Versione stato daemon',
    activeSessions: ({ count }: { count: number }) => `Sessioni attive (${count})`,
    machineGroup: 'Macchina',
    host: 'Host',
    machineId: 'ID macchina',
    username: 'Nome utente',
    homeDirectory: 'Directory home',
    platform: 'Piattaforma',
    architecture: 'Architettura',
    lastSeen: 'Ultimo accesso',
    never: 'Mai',
    metadataVersion: 'Versione metadati',
    untitledSession: 'Sessione senza titolo',
    back: 'Indietro',
  },

  message: {
    switchedToMode: ({ mode }: { mode: string }) => `Passato alla modalità ${mode}`,
    unknownEvent: 'Evento sconosciuto',
    usageLimitUntil: ({ time }: { time: string }) => `Limite di utilizzo raggiunto fino a ${time}`,
    unknownTime: 'ora sconosciuta',
    permissionRequest: ({ toolName }: { toolName: string }) => 'Permission request for ' + toolName,
    permissionMode: ({ mode }: { mode: string }) => 'Permission mode: ' + mode,
  },

  chatList: {
    pullToRefresh: 'Scorri per aggiornare',
    releaseToRefresh: 'Rilascia per aggiornare',
    refreshing: 'Aggiornamento...',
    pullToLoadEarlier: 'Scorri per caricare i precedenti',
    releaseToLoadEarlier: 'Rilascia per caricare i precedenti',
    loadingEarlier: 'Caricamento...',
    navPanelPartialHint:
      'Mostra solo i messaggi caricati. Scorri verso l alto per caricare i precedenti.',
    scrollToBottom: 'Vai in fondo',
    newMessages: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? 'nuovo messaggio' : 'nuovi messaggi'}`,
    today: 'Oggi',
    yesterday: 'Ieri',
  },

  codex: {
    // Codex permission dialog buttons
    permissions: {
      yesForSession: 'Sì, e non chiedere per una sessione',
      stopAndExplain: 'Fermati e spiega cosa devo fare',
    },
  },

  claude: {
    // Claude permission dialog buttons
    permissions: {
      yesAllowAllEdits: 'Sì, consenti tutte le modifiche durante questa sessione',
      yesForTool: 'Sì, non chiedere più per questo strumento',
      noTellClaude: 'No, fornisci feedback',
    },
  },

  textSelection: {
    // Text selection screen
    selectText: 'Seleziona intervallo di testo',
    title: 'Seleziona testo',
    noTextProvided: 'Nessun testo fornito',
    textNotFound: 'Testo non trovato o scaduto',
    textCopied: 'Testo copiato negli appunti',
    failedToCopy: 'Impossibile copiare il testo negli appunti',
    noTextToCopy: 'Nessun testo disponibile da copiare',
  },

  markdown: {
    // Markdown copy functionality
    codeCopied: 'Codice copiato',
    copyFailed: 'Copia non riuscita',
    mermaidRenderFailed: 'Impossibile renderizzare il diagramma mermaid',
  },

  artifacts: {
    // Artifacts feature
    title: 'Artefatti',
    countSingular: '1 artefatto',
    countPlural: ({ count }: { count: number }) => `${count} artefatti`,
    empty: 'Nessun artefatto',
    emptyDescription: 'Crea il tuo primo artefatto per iniziare',
    new: 'Nuovo artefatto',
    edit: 'Modifica artefatto',
    delete: 'Elimina',
    updateError: "Impossibile aggiornare l'artefatto. Riprova.",
    notFound: 'Artefatto non trovato',
    discardChanges: 'Scartare le modifiche?',
    discardChangesDescription: 'Hai modifiche non salvate. Sei sicuro di volerle scartare?',
    deleteConfirm: 'Eliminare artefatto?',
    deleteConfirmDescription: 'Questa azione non può essere annullata',
    titleLabel: 'TITOLO',
    titlePlaceholder: 'Inserisci un titolo per il tuo artefatto',
    bodyLabel: 'CONTENUTO',
    bodyPlaceholder: 'Scrivi il tuo contenuto qui...',
    emptyFieldsError: 'Inserisci un titolo o un contenuto',
    createError: "Impossibile creare l'artefatto. Riprova.",
    save: 'Salva',
    saving: 'Salvataggio...',
    loading: 'Caricamento artefatti...',
    error: "Impossibile caricare l'artefatto",
  },

  friends: {
    // Friends feature
    title: 'Amici',
    manageFriends: 'Gestisci i tuoi amici e le connessioni',
    searchTitle: 'Trova amici',
    pendingRequests: 'Richieste di amicizia',
    myFriends: 'I miei amici',
    noFriendsYet: 'Non hai ancora amici',
    findFriends: 'Trova amici',
    remove: 'Rimuovi',
    pendingRequest: 'In attesa',
    sentOn: ({ date }: { date: string }) => `Inviata il ${date}`,
    accept: 'Accetta',
    reject: 'Rifiuta',
    addFriend: 'Aggiungi amico',
    alreadyFriends: 'Già amici',
    requestPending: 'Richiesta in sospeso',
    searchInstructions: 'Inserisci un nome utente per cercare amici',
    searchPlaceholder: 'Inserisci nome utente...',
    searching: 'Ricerca...',
    userNotFound: 'Utente non trovato',
    noUserFound: 'Nessun utente trovato con quel nome',
    checkUsername: 'Controlla il nome utente e riprova',
    howToFind: 'Come trovare amici',
    findInstructions:
      'Cerca amici tramite il loro nome utente. Sia tu che il tuo amico dovete avere GitHub collegato per inviare richieste di amicizia.',
    requestSent: 'Richiesta di amicizia inviata!',
    requestAccepted: 'Richiesta di amicizia accettata!',
    requestRejected: 'Richiesta di amicizia rifiutata',
    friendRemoved: 'Amico rimosso',
    confirmRemove: 'Rimuovi amico',
    confirmRemoveMessage: 'Sei sicuro di voler rimuovere questo amico?',
    cannotAddYourself: 'Non puoi inviare una richiesta di amicizia a te stesso',
    bothMustHaveGithub: 'Entrambi gli utenti devono avere GitHub collegato per diventare amici',
    status: {
      none: 'Non connesso',
      requested: 'Richiesta inviata',
      pending: 'Richiesta in sospeso',
      friend: 'Amici',
      rejected: 'Rifiutata',
    },
    acceptRequest: 'Accetta richiesta',
    removeFriend: 'Rimuovi amico',
    removeFriendConfirm: ({ name }: { name: string }) =>
      `Sei sicuro di voler rimuovere ${name} dagli amici?`,
    requestSentDescription: ({ name }: { name: string }) =>
      `La tua richiesta di amicizia è stata inviata a ${name}`,
    requestFriendship: 'Richiedi amicizia',
    cancelRequest: 'Annulla richiesta di amicizia',
    cancelRequestConfirm: ({ name }: { name: string }) =>
      `Annullare la tua richiesta di amicizia a ${name}?`,
    denyRequest: 'Rifiuta richiesta',
    nowFriendsWith: ({ name }: { name: string }) => `Ora sei amico di ${name}`,
  },

  usage: {
    // Usage panel strings
    today: 'Oggi',
    last7Days: 'Ultimi 7 giorni',
    last30Days: 'Ultimi 30 giorni',
    totalTokens: 'Token totali',
    totalCost: 'Costo totale',
    tokens: 'Token',
    cost: 'Costo',
    usageOverTime: 'Utilizzo nel tempo',
    byModel: 'Per modello',
    noData: 'Nessun dato di utilizzo disponibile',
    breakdown: 'Dettaglio',
    agent: 'Agente',
    modelDimension: 'Modello',
    source: 'Origine',
    clearFilter: 'Cancella',
    filteringBy: ({ dimension, value }: { dimension: string; value: string }) =>
      `Filtrato per ${dimension}: ${value}`,
    sessionOnly: 'Visualizzazione solo di questa sessione',
  },

  dev: {
    appInformation: 'Informazioni app',
    version: 'Versione',
    buildNumber: 'Numero di build',
    runtimeVersion: 'Versione runtime',
    packageSource: 'Fonte del pacchetto',
    buildTime: 'Data di build',
    sdkVersion: 'Versione SDK',
    platform: 'Piattaforma',
    anonymousId: 'ID anonimo',
    notAvailable: 'Non disponibile',
    debugOptions: 'Opzioni di debug',
    showDebugIds: 'Mostra ID di debug',
    showDebugIdsSubtitle: 'Mostra ID di sessione, ID agente e JSON raw nelle informazioni della sessione',
    componentDemos: 'Demo dei componenti',
    deviceInfo: 'Informazioni dispositivo',
    deviceInfoSubtitle: 'Margini area sicura e parametri del dispositivo',
    listComponents: 'Componenti lista',
    listComponentsSubtitle: 'Demo di Item, ItemGroup e ItemList',
    typography: 'Tipografia',
    typographySubtitle: 'Tutti gli stili tipografici',
    colors: 'Colori',
    colorsSubtitle: 'Palette colori e temi',
    messageDemos: 'Demo messaggi',
    messageDemosSubtitle: 'Vari tipi di messaggi e componenti',
    invertedListTest: 'Test lista invertita',
    invertedListTestSubtitle: 'Testare FlatList invertita con tastiera',
    toolViews: 'Viste strumenti',
    toolViewsSubtitle: 'Componenti di visualizzazione delle chiamate strumenti',
    shimmerView: 'Vista shimmer',
    shimmerViewSubtitle: 'Effetti di caricamento shimmer con maschere',
    multiTextInput: 'Input testo multilinea',
    multiTextInputSubtitle: 'Input testo multilinea con crescita automatica',
    inputStyles: 'Stili di input',
    inputStylesSubtitle: '10+ varianti di stili dei campi di input',
    modalSystem: 'Sistema modale',
    modalSystemSubtitle: 'Avvisi, conferme e modali personalizzati',
    unitTests: 'Test unitari',
    unitTestsSubtitle: 'Esegui test nell\'ambiente dell\'app',
    unistylesDemo: 'Demo Unistyles',
    unistylesDemoSubtitle: 'Funzionalità e capacità di React Native Unistyles',
    qrCodeTest: 'Test codice QR',
    qrCodeTestSubtitle: 'Testa la generazione di codici QR con diversi parametri',
    testFeatures: 'Funzionalità di test',
    testFeaturesFooter: 'Queste azioni possono influire sulla stabilità dell\'app',
    claudeOAuthTest: 'Test OAuth Claude',
    claudeOAuthTestSubtitle: 'Testa il flusso di autenticazione Claude',
    testCrash: 'Test di crash',
    testCrashSubtitle: 'Provoca un crash di test',
    testCrashConfirmTitle: 'Test di crash',
    testCrashConfirmMessage: 'Questo causerà il crash dell\'app. Continuare?',
    crash: 'Crash',
    clearCache: 'Svuota cache',
    clearCacheSubtitle: 'Rimuovi tutti i dati nella cache',
    clearCacheConfirmTitle: 'Svuota cache',
    clearCacheConfirmMessage: 'Sei sicuro di voler svuotare tutti i dati nella cache? I messaggi verranno recuperati nuovamente dal server.',
    clear: 'Svuota',
    cacheCleared: 'Cache svuotata',
    failedToClearCache: ({ error }: { error: string }) => `Impossibile svuotare la cache: ${error}`,
    resetChangelog: 'Reimposta registro modifiche',
    resetChangelogSubtitle: 'Mostra nuovamente il banner "Novità"',
    changelogReset: 'Registro modifiche reimpostato. Riavvia l\'app per vedere il banner.',
    resetAppState: 'Reimposta stato app',
    resetAppStateSubtitle: 'Cancella tutti i dati e le preferenze utente',
    resetApp: 'Reimposta app',
    resetAppConfirmMessage: 'Questo eliminerà tutti i dati. Sei sicuro?',
    system: 'Sistema',
    purchases: 'Acquisti',
    purchasesSubtitle: 'Visualizza abbonamenti e permessi',
    expoConstants: 'Costanti Expo',
    expoConstantsSubtitle: 'Visualizza expoConfig, manifests e costanti di sistema',
    network: 'Rete',
    apiEndpoint: 'Endpoint API',
    socketIoStatus: 'Stato Socket.IO',
    editApiEndpoint: 'Modifica endpoint API',
    enterServerUrl: 'Inserisci l\'URL del server:',
    serverUrlUpdated: 'URL del server aggiornato. Riavvia l\'app per applicare le modifiche.',
    invalidUrl: 'URL non valido',
    invalidUrlDefault: 'Inserisci un URL valido',
    justNow: 'Proprio ora',
    secondsAgo: ({ seconds }: { seconds: number }) => `${seconds}s fa`,
    minutesAgo: ({ minutes }: { minutes: number }) => `${minutes}m fa`,
    hoursAgo: ({ hours }: { hours: number }) => `${hours}h fa`,
    daysAgo: ({ days }: { days: number }) => `${days}g fa`,
    connectedAgo: ({ time }: { time: string }) => `Connesso ${time}`,
    lastConnectedAgo: ({ time }: { time: string }) => `Ultima connessione ${time}`,
    connectingToServer: 'Connessione al server...',
    noConnectionInfo: 'Nessuna informazione di connessione',
    done: 'Fatto',
  },

  feed: {
    // Feed notifications for friend requests and acceptances
    friendRequestFrom: ({ name }: { name: string }) =>
      `${name} ti ha inviato una richiesta di amicizia`,
    friendRequestGeneric: 'Nuova richiesta di amicizia',
    friendAccepted: ({ name }: { name: string }) => `Ora sei amico di ${name}`,
    friendAcceptedGeneric: 'Richiesta di amicizia accettata',
  },

  voiceStatusBar: {
    connecting: 'Connessione in corso...',
    reconnecting: 'Riconnessione in corso...',
    active: 'Assistente vocale attivo',
    error: 'Errore di connessione',
    default: 'Assistente vocale',
    tapToEnd: 'Tocca per terminare',
  },
} as const;

export type TranslationsIt = typeof it;
