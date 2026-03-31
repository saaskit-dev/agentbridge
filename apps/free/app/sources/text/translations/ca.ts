import type { TranslationStructure } from '../_default';

/**
 * Catalan plural helper function
 * Catalan has 2 plural forms: singular, plural
 * @param options - Object containing count, singular, and plural forms
 * @returns The appropriate form based on Catalan plural rules
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
 * Catalan translations for the Free app
 * Must match the exact structure of the English translations
 */
export const ca: TranslationStructure = {
  tabs: {
    // Tab navigation labels
    inbox: 'Safata',
    sessions: 'Sessions',
    settings: 'Configuració',
  },

  inbox: {
    // Inbox screen
    emptyTitle: 'Safata buida',
    emptyDescription: "Connecta't amb amics per començar a compartir sessions",
    updates: 'Actualitzacions',
  },

  common: {
    // Simple string constants
    cancel: 'Cancel·la',
    authenticate: 'Autentica',
    save: 'Desa',
    saveAs: 'Desa com a',
    error: 'Error',
    success: 'Èxit',
    ok: "D'acord",
    continue: 'Continua',
    back: 'Enrere',
    create: 'Crear',
    rename: 'Reanomena',
    reset: 'Reinicia',
    logout: 'Tanca la sessió',
    yes: 'Sí',
    no: 'No',
    discard: 'Descarta',
    version: 'Versió',
    copied: 'Copiat',
    copy: 'Copiar',
    scanning: 'Escanejant...',
    urlPlaceholder: 'https://exemple.com',
    home: 'Inici',
    message: 'Missatge',
    files: 'Fitxers',
    fileViewer: 'Visualitzador de fitxers',
    loading: 'Carregant...',
    retry: 'Torna-ho a provar',
    delete: 'Elimina',
    optional: 'Opcional',
  },

  profile: {
    userProfile: "Perfil d'usuari",
    details: 'Detalls',
    firstName: 'Nom',
    lastName: 'Cognoms',
    username: "Nom d'usuari",
    status: 'Estat',
  },

  status: {
    connected: 'connectat',
    connecting: 'connectant',
    disconnected: 'desconnectat',
    error: 'error',
    authError: 'sessió caducada, tancant sessió...',
    online: 'en línia',
    offline: 'fora de línia',
    lastSeen: ({ time }: { time: string }) => `vist per última vegada ${time}`,
    permissionRequired: 'permís requerit',
    recoveryFailed: 'recuperació fallida',
    activeNow: 'Actiu ara',
    unknown: 'desconegut',
    machinesOnline: ({ count }: { count: number }) =>
      count === 0 ? 'sense màquines' : `${count} ${count === 1 ? 'màquina' : 'màquines'} en línia`,
  },

  time: {
    justNow: 'ara mateix',
    minutesAgo: ({ count }: { count: number }) => `fa ${count} minut${count !== 1 ? 's' : ''}`,
    hoursAgo: ({ count }: { count: number }) => `fa ${count} hora${count !== 1 ? 'es' : ''}`,
  },

  connect: {
    restoreAccount: 'Restaura el compte',
    enterSecretKey: 'Introdueix la teva clau secreta',
    invalidSecretKey: 'Clau secreta no vàlida. Comprova-ho i torna-ho a provar.',
    enterUrlManually: "Introdueix l'URL manualment",
    connectName: ({ name }: { name: string }) => `Connecta ${name}`,
    runCommandInTerminal: 'Executa la següent comanda al terminal:',
  },

  restore: {
    enterSecretKeyInstruction: 'Introdueix la teva clau secreta per restaurar l\'accés al teu compte.',
    secretKeyPlaceholder: 'XXXXX-XXXXX-XXXXX...',
    qrStep1: '1. Obre Free al teu dispositiu mòbil',
    qrStep2: '2. Vés a Configuració → Compte',
    qrStep3: '3. Toca "Vincular nou dispositiu"',
    qrStep4: '4. Escaneja aquest codi QR',
    restoreWithSecretKeyInstead: 'Restaurar amb clau secreta',
  },

  support: {
    tierCoffee: 'Company de cafè',
    tierCoffeePrice: '¥12',
    tierCoffeePeriod: '/mes',
    tierCoffeeDescription: 'Un cafè per impulsar el desenvolupament',
    tierCoffeeFeature1: 'Sense insígnia de patrocinador a l\'app',
    tierCoffeeFeature2: 'Accés anticipat a noves funcionalitats',
    tierBuilder: 'Constructor',
    tierBuilderPrice: '¥38',
    tierBuilderPeriod: '/mes',
    tierBuilderDescription: 'Modela el futur de la programació junts',
    tierBuilderFeature1: 'Tots els beneficis de Company de cafè',
    tierBuilderFeature2: 'Canal exclusiu de Discord',
    tierBuilderFeature3: 'Q&A mensual 1 a 1',
    tierPioneer: 'Pioner',
    tierPioneerPrice: '¥98',
    tierPioneerPeriod: '/mes',
    tierPioneerDescription: 'Una experiència exclusiva per a pioners',
    tierPioneerFeature1: 'Tots els beneficis de Constructor',
    tierPioneerFeature2: 'Accés anticipat a funcionalitats experimentals',
    tierPioneerFeature3: 'Prioritat per a sol·licituds personalitzades',
    tierPioneerFeature4: 'Consultoria tècnica dedicada',
    title: 'Suport',
    thankYouTitle: 'Gràcies',
    purchaseSuccess: ({ name }: { name: string }) => `Ara ets un「${name}」. Gràcies pel teu suport!`,
    purchaseFailed: 'Compra fallida',
    unknownError: 'Error desconegut, torna-ho a provar',
    thankYouMessage: 'Gràcies pel teu suport',
    thankYouDescription: 'Ets un valuós Constructor. El teu suport impulsa la nostra innovació contínua.',
    supportDevelopment: 'Suporta el desenvolupament',
    supportDescription: 'El teu suport impulsa la nostra innovació contínua. Tria un pla que et funcioni i modela el futur de la programació junts.',
    recommended: 'Recomanat',
    processing: 'Processant...',
    joinTier: ({ name, price, period }: { name: string; price: string; period: string }) => `Uneix-te a ${name} · ${price}${period}`,
    cancellableSecurePayment: 'Cancel·la en qualsevol moment · Pagament segur',
  },

  settings: {
    title: 'Configuració',
    connectedAccounts: 'Comptes connectats',
    connectAccount: 'Connectar compte',
    github: 'GitHub',
    machines: 'Màquines',
    features: 'Funcions',
    social: 'Social',
    account: 'Compte',
    accountSubtitle: 'Gestiona els detalls del teu compte',
    appearance: 'Aparença',
    appearanceSubtitle: "Personalitza l'aspecte de l'aplicació",
    featuresTitle: 'Funcions',
    featuresSubtitle: "Activa o desactiva les funcions de l'aplicació",
    developer: 'Desenvolupador',
    exitDeveloperMode: 'Sortir del mode de desenvolupador',
    developerTools: 'Eines de desenvolupador',
    about: 'Quant a',
    aboutFooter:
      'Free Coder és un client mòbil de Codex i Claude Code. Tot està xifrat punt a punt i el teu compte es guarda només al teu dispositiu. No està afiliat amb Anthropic.',
    whatsNew: 'Novetats',
    whatsNewSubtitle: 'Mira les últimes actualitzacions i millores',
    reportIssue: "Informa d'un problema",
    privacyPolicy: 'Política de privadesa',
    termsOfService: 'Condicions del servei',
    eula: 'EULA',
    scanQrCodeToAuthenticate: 'Escaneja el codi QR per autenticar-te',
    githubConnected: ({ login }: { login: string }) => `Connectat com a @${login}`,
    connectGithubAccount: 'Connecta el teu compte de GitHub',
    claudeAuthSuccess: 'Connexió amb Claude realitzada amb èxit',
    exchangingTokens: 'Intercanviant tokens...',
    usage: 'Ús',
    usageSubtitle: "Veure l'ús de l'API i costos",
    supportUs: 'Uneix-te a nosaltres',
    supportUsSubtitlePro: 'Ets un Constructor 🎉',
    supportUsSubtitle: 'Sigues part del futur',

    // Dynamic settings messages
    accountConnected: ({ service }: { service: string }) => `Compte de ${service} connectat`,
    machineStatus: ({ name, status }: { name: string; status: 'online' | 'offline' }) =>
      `${name} està ${status === 'online' ? 'en línia' : 'fora de línia'}`,
    featureToggled: ({ feature, enabled }: { feature: string; enabled: boolean }) =>
      `${feature} ${enabled ? 'activada' : 'desactivada'}`,
  },

  settingsAppearance: {
    // Appearance settings screen
    theme: 'Tema',
    themeDescription: 'Tria el teu esquema de colors preferit',
    themeOptions: {
      adaptive: 'Adaptatiu',
      light: 'Clar',
      dark: 'Fosc',
    },
    themeDescriptions: {
      adaptive: 'Segueix la configuració del sistema',
      light: 'Usa sempre el tema clar',
      dark: 'Usa sempre el tema fosc',
    },
    display: 'Pantalla',
    displayDescription: "Controla la disposició i l'espaiat",
    inlineToolCalls: "Crides d'eines en línia",
    inlineToolCallsDescription: "Mostra les crides d'eines directament als missatges de xat",
    expandTodoLists: 'Expandeix les llistes de tasques',
    expandTodoListsDescription: 'Mostra totes les tasques en lloc de només els canvis',
    showLineNumbersInDiffs: 'Mostra els números de línia a les diferències',
    showLineNumbersInDiffsDescription: 'Mostra els números de línia a les diferències de codi',
    showLineNumbersInToolViews: "Mostra els números de línia a les vistes d'eines",
    showLineNumbersInToolViewsDescription:
      "Mostra els números de línia a les diferències de vistes d'eines",
    wrapLinesInDiffs: 'Ajusta les línies a les diferències',
    wrapLinesInDiffsDescription:
      'Ajusta les línies llargues en lloc de desplaçament horitzontal a les vistes de diferències',
    alwaysShowContextSize: 'Mostra sempre la mida del context',
    alwaysShowContextSizeDescription:
      "Mostra l'ús del context fins i tot quan no estigui prop del límit",
    avatarStyle: "Estil d'avatar",
    avatarStyleDescription: "Tria l'aparença de l'avatar de la sessió",
    avatarOptions: {
      pixelated: 'Pixelat',
      gradient: 'Gradient',
      brutalist: 'Brutalista',
    },
    showFlavorIcons: "Mostrar icones de proveïdors d'IA",
    showFlavorIconsDescription: "Mostrar icones del proveïdor d'IA als avatars de sessió",
    compactSessionView: 'Vista compacta de sessions',
    compactSessionViewDescription: 'Mostra les sessions actives en un disseny més compacte',
  },

  settingsFeatures: {
    // Features settings screen
    experiments: 'Experiments',
    experimentsDescription:
      'Activa funcions experimentals que encara estan en desenvolupament. Aquestes funcions poden ser inestables o canviar sense avís.',
    experimentalFeatures: 'Funcions experimentals',
    experimentalFeaturesEnabled: 'Funcions experimentals activades',
    experimentalFeaturesDisabled: 'Utilitzant només funcions estables',
    webFeatures: 'Funcions web',
    webFeaturesDescription: "Funcions disponibles només a la versió web de l'app.",
    enterToSend: 'Enter per enviar',
    enterToSendEnabled: 'Prem Enter per enviar (Maj+Enter per a una nova línia)',
    enterToSendDisabled: 'Enter insereix una nova línia',
    commandPalette: 'Paleta de comandes',
    commandPaletteEnabled: 'Prem ⌘K per obrir',
    commandPaletteDisabled: 'Accés ràpid a comandes desactivat',
    markdownCopyV2: 'Markdown Copy v2',
    markdownCopyV2Subtitle: 'Pulsació llarga obre modal de còpia',
    hideInactiveSessions: 'Amaga les sessions inactives',
    hideInactiveSessionsSubtitle: 'Mostra només els xats actius a la llista',
    enhancedSessionWizard: 'Assistent de sessió millorat',
    enhancedSessionWizardEnabled: 'Llançador de sessió amb perfil actiu',
    enhancedSessionWizardDisabled: 'Usant el llançador de sessió estàndard',

},

  errors: {
    networkError: 'Error de connexió',
    serverError: 'Error del servidor',
    unknownError: 'Error desconegut',
    connectionTimeout: "S'ha esgotat el temps de connexió",
    authenticationFailed: "L'autenticació ha fallat",
    permissionDenied: 'Permís denegat',
    fileNotFound: 'Fitxer no trobat',
    invalidFormat: 'Format no vàlid',
    operationFailed: "L'operació ha fallat",
    tryAgain: 'Torna-ho a provar',
    contactSupport: 'Contacta amb el suport si el problema persisteix',
    sessionNotFound: 'Sessió no trobada',
    voiceSessionFailed: "Ha fallat l'inici de la sessió de veu",
    voiceServiceUnavailable: 'El servei de veu no està disponible temporalment',
    voiceNotConfigured: 'Voice feature is not configured. Please contact support.',
    voiceNotInitialized:
      'Voice service failed to initialize. Please restart the app and try again.',
    voiceMicPermissionWeb:
      'Microphone access is required for voice. Please allow microphone permission in your browser settings.',
    voiceTokenRejected: 'Voice service is not available on this server.',
    oauthInitializationFailed: 'Ha fallat la inicialització del flux OAuth',
    tokenStorageFailed: "Ha fallat l'emmagatzematge dels tokens d'autenticació",
    oauthStateMismatch: 'Ha fallat la validació de seguretat. Si us plau, torna-ho a provar',
    tokenExchangeFailed: "Ha fallat l'intercanvi del codi d'autorització",
    oauthAuthorizationDenied: "L'autorització ha estat denegada",
    webViewLoadFailed: "Ha fallat la càrrega de la pàgina d'autenticació",
    failedToLoadProfile: "No s'ha pogut carregar el perfil d'usuari",
    userNotFound: 'Usuari no trobat',
    sessionDeleted: "La sessió s'ha eliminat",
    sessionDeletedDescription: "Aquesta sessió s'ha eliminat permanentment",

    // Error functions with context
    fieldError: ({ field, reason }: { field: string; reason: string }) => `${field}: ${reason}`,
    validationError: ({ field, min, max }: { field: string; min: number; max: number }) =>
      `${field} ha d'estar entre ${min} i ${max}`,
    retryIn: ({ seconds }: { seconds: number }) =>
      `Torna-ho a provar en ${seconds} ${seconds === 1 ? 'segon' : 'segons'}`,
    errorWithCode: ({ message, code }: { message: string; code: number | string }) =>
      `${message} (Error ${code})`,
    disconnectServiceFailed: ({ service }: { service: string }) =>
      `Ha fallat la desconnexió de ${service}`,
    connectServiceFailed: ({ service }: { service: string }) =>
      `No s'ha pogut connectar ${service}. Si us plau, torna-ho a provar.`,
    failedToLoadFriends: "No s'ha pogut carregar la llista d'amics",
    failedToAcceptRequest: "No s'ha pogut acceptar la sol·licitud d'amistat",
    failedToRejectRequest: "No s'ha pogut rebutjar la sol·licitud d'amistat",
    failedToRemoveFriend: "No s'ha pogut eliminar l'amic",
    searchFailed: 'La cerca ha fallat. Si us plau, torna-ho a provar.',
    failedToSendRequest: "No s'ha pogut enviar la sol·licitud d'amistat",
  },

  newSession: {
    // Used by new-session screen and launch flows
    title: 'Inicia una nova sessió',
    noMachinesFound: "No s'han trobat màquines. Inicia una sessió de Free al teu ordinador primer.",
    allMachinesOffline: 'Totes les màquines estan fora de línia',
    machineDetails: 'Veure detalls de la màquina →',
    directoryDoesNotExist: 'Directori no trobat',
    createDirectoryConfirm: ({ directory }: { directory: string }) =>
      `El directori ${directory} no existeix. Vols crear-lo?`,
    sessionStarted: 'Sessió iniciada',
    sessionStartedMessage: "La sessió s'ha iniciat correctament.",
    sessionSpawningFailed: "Ha fallat la creació de la sessió - no s'ha retornat cap ID de sessió.",
    failedToStart:
      "Ha fallat l'inici de la sessió. Assegura't que el dimoni s'estigui executant a la màquina de destinació.",
    sessionTimeout:
      "L'inici de la sessió ha esgotat el temps d'espera. La màquina pot ser lenta o el dimoni pot no estar responent.",
    notConnectedToServer: 'No connectat al servidor. Comprova la teva connexió a internet.',
    startingSession: 'Iniciant la sessió...',
    startNewSessionInFolder: 'Nova sessió aquí',
    noMachineSelected: 'Si us plau, selecciona una màquina per iniciar la sessió',
    noPathSelected: 'Si us plau, selecciona un directori per iniciar la sessió',
    sessionType: {
      title: 'Tipus de sessió',
      simple: 'Simple',
      worktree: 'Worktree',
      comingSoon: 'Properament',
    },
    worktree: {
      creating: ({ name }: { name: string }) => `Creant worktree '${name}'...`,
      notGitRepo: 'Els worktrees requereixen un repositori git',
      failed: ({ error }: { error: string }) => `Error en crear el worktree: ${error}`,
      success: 'Worktree creat amb èxit',
    },
    inputPlaceholder: 'En què voldries treballar?',
    capabilityDiscoveryNotice:
      'Envia el teu primer missatge per carregar modes, models i comandes.',
  },

  agentPicker: {
    headerTitle: 'Selecciona un agent',
    heroEyebrow: "Selector d'implementació",
    heroTitle: "Tria el temps d'execució amb el qual vols començar.",
    heroDescription:
      'Cada opció de sota es descobreix a partir de les implementacions registrades a la màquina seleccionada. Les entrades clàssiques i ACP es mantenen separades intencionadament.',
    experimentalSection: 'Experimental',
    experimentalCaption: "Agents opcionals darrere de la configuració d'experiments.",
    noAgentsTitle: 'No hi ha agents disponibles',
    noAgentsDescription: 'Aquesta màquina no ha informat de cap implementació executable.',
    tagAcp: 'ACP',
    tagClassic: 'Clàssic',
    tagAnthropic: 'Anthropic',
    tagOpenAI: 'OpenAI',
    tagGoogle: 'Google',
    tagTerminal: 'Terminal',
    tagExperimental: 'Experimental',
  },

  machinePicker: {
    headerTitle: 'Selecciona una màquina',
    noMachinesAvailable: 'No hi ha màquines disponibles',
    online: 'en línia',
    offline: 'fora de línia',
    searchPlaceholder: 'Escriu per filtrar màquines...',
    recentSection: 'Màquines recents',
    favoritesSection: 'Màquines favorites',
    allSection: 'Tots els dispositius',
  },

  pathPicker: {
    headerTitle: 'Selecciona un camí',
    noMachineSelected: 'Cap màquina seleccionada',
    enterPath: 'Introdueix un camí',
    enterPathPlaceholder: 'Introdueix un camí (p. ex. /home/user/projects)',
    recentPaths: 'Camins recents',
    suggestedPaths: 'Camins suggerits',
    browse: 'Explorar',
    browseError: "No s'ha pogut carregar el directori",
    emptyDirectory: 'Sense subdirectoris',
  },

  sessionHistory: {
    // Used by session history screen
    title: 'Historial de sessions',
    empty: "No s'han trobat sessions",
    today: 'Avui',
    yesterday: 'Ahir',
    daysAgo: ({ count }: { count: number }) => `fa ${count} ${count === 1 ? 'dia' : 'dies'}`,
    viewAll: 'Veure totes les sessions',
  },

  session: {
    inputPlaceholder: 'Escriu un missatge...',
    sendFailed: 'Error en enviar. Toca per reintentar.',
    sendBlockedServerDisconnected: 'Servidor desconnectat, no es pot enviar el missatge',
    sendBlockedDaemonOffline: 'Sessió fora de línia, no es pot enviar el missatge',
    addImage: 'Afegir imatge',
    pasteFromClipboard: 'Enganxar del porta-retalls',
    chooseFromLibrary: 'Triar de la biblioteca',
  },

  commandPalette: {
    placeholder: 'Escriu una comanda o cerca...',
  },

  server: {
    // Used by Server Configuration screen (app/(app)/server.tsx)
    serverConfiguration: 'Configuració del servidor',
    enterServerUrl: 'Introdueix una URL del servidor',
    notValidFreeServer: 'No és un servidor Free vàlid',
    changeServer: 'Canvia el servidor',
    continueWithServer: 'Continuar amb aquest servidor?',
    resetToDefault: 'Reinicia per defecte',
    resetServerDefault: 'Reiniciar el servidor per defecte?',
    validating: 'Validant...',
    validatingServer: 'Validant el servidor...',
    serverReturnedError: 'El servidor ha retornat un error',
    failedToConnectToServer: 'Ha fallat la connexió amb el servidor',
    currentlyUsingCustomServer: 'Actualment utilitzant un servidor personalitzat',
    customServerUrlLabel: 'URL del servidor personalitzat',
    advancedFeatureFooter:
      'Aquesta és una funció avançada. Només canvia el servidor si saps el que fas. Hauràs de tancar la sessió i tornar-la a iniciar després de canviar els servidors.',
  },

  sessionInfo: {
    // Used by Session Info screen (app/(app)/session/[id]/info.tsx)
    killSession: 'Finalitza la sessió',
    killSessionConfirm: 'Segur que vols finalitzar aquesta sessió?',
    archiveSession: 'Arxiva la sessió',
    archiveSessionConfirm: 'Segur que vols arxivar aquesta sessió?',
    freeSessionIdCopied: 'ID de la sessió de Free copiat al porta-retalls',
    failedToCopySessionId: "Ha fallat copiar l'ID de la sessió de Free",
    freeSessionId: 'ID de la sessió de Free',
    agentSessionId: 'ID de la sessió de Claude Code',
    agentSessionIdCopied: 'ID de la sessió de Claude Code copiat al porta-retalls',
    aiProvider: "Proveïdor d'IA",
    failedToCopyAgentSessionId: "Ha fallat copiar l'ID de la sessió de Claude Code",
    metadataCopied: 'Metadades copiades al porta-retalls',
    failedToCopyMetadata: 'Ha fallat copiar les metadades',
    failedToKillSession: 'Ha fallat finalitzar la sessió',
    failedToArchiveSession: 'Ha fallat arxivar la sessió',
    connectionStatus: 'Estat de la connexió',
    created: 'Creat',
    lastUpdated: 'Última actualització',
    sequence: 'Seqüència',
    quickActions: 'Accions ràpides',
    viewMachine: 'Veure la màquina',
    viewMachineSubtitle: 'Veure detalls de la màquina i sessions',
    killSessionSubtitle: 'Finalitzar immediatament la sessió',
    archiveSessionSubtitle: 'Arxiva aquesta sessió i atura-la',
    recoveryFailedArchiveSubtitle: 'Aquesta sessió no s\'ha pogut recuperar després d\'una fallada',
    metadata: 'Metadades',
    host: 'Host',
    path: 'Camí',
    operatingSystem: 'Sistema operatiu',
    processId: 'ID del procés',
    freeHome: 'Directori de Free',
    copyMetadata: 'Copia les metadades',
    agentState: "Estat de l'agent",
    controlledByUser: "Controlat per l'usuari",
    pendingRequests: 'Sol·licituds pendents',
    activity: 'Activitat',
    thinking: 'Pensant',
    thinkingSince: 'Pensant des de',
    cliVersion: 'Versió del CLI',
    cliVersionOutdated: 'Actualització del CLI requerida',
    cliVersionOutdatedMessage: ({
      currentVersion,
      requiredVersion,
    }: {
      currentVersion: string;
      requiredVersion: string;
    }) => `Versió ${currentVersion} instal·lada. Actualitzeu a ${requiredVersion} o posterior`,
    updateCliInstructions:
      'Si us plau executeu npm install -g @saaskit-dev/free',
    restartAgent: "Reinici forçat de l'agent",
    restartAgentConfirm: "Això acabarà el procés de l'agent actual i n'iniciarà un de nou. La sessió i l'historial de conversa es conservaran.",
    restartAgentSubtitle: "Acabar i reiniciar el procés de l'agent",
    restartAgentSuccess: "El procés de l'agent s'està reiniciant.",
    failedToRestartAgent: "Error en reiniciar l'agent",
    deleteSession: 'Elimina la sessió',
    deleteSessionSubtitle: 'Elimina permanentment aquesta sessió',
    deleteSessionConfirm: 'Eliminar la sessió permanentment?',
    deleteSessionWarning:
      "Aquesta acció no es pot desfer. Tots els missatges i dades associats amb aquesta sessió s'eliminaran permanentment.",
    failedToDeleteSession: 'Error en eliminar la sessió',
    sessionDeleted: 'Sessió eliminada amb èxit',
    clearCache: 'Netejar memòria cau',
    clearCacheSubtitle: "Netejar les dades de memòria cau local d'aquesta sessió",
    clearCacheConfirm: "Netejar totes les dades de memòria cau d'aquesta sessió? Els missatges es tornaran a obtenir del servidor.",
    clearCacheSuccess: 'Memòria cau netejada correctament',
    clearCacheFailed: 'No s\'ha pogut netejar la memòria cau',
  },

  components: {
    emptyMainScreen: {
      // Used by EmptyMainScreen component
      readyToCode: 'Llest per programar?',
      installCli: 'Instal·la el Free CLI',
      runIt: "Executa'l",
      scanQrCode: 'Escaneja el codi QR',
      openCamera: 'Obre la càmera',
    },
  },

  agentInput: {
    permissionMode: {
      title: 'MODE DE PERMISOS',
      readOnly: 'Només lectura',
      acceptEdits: 'Accepta edicions',
      yolo: 'YOLO',
      badgeReadOnly: 'Només lectura',
      badgeAcceptEdits: 'Accepta edicions',
      badgeYolo: 'YOLO',
    },
    agentTitle: 'Agent',
    agentModeTitle: "Mode d'agent",
    experimentalSection: 'Experimental',
    agent: {
      claude: 'Claude',
      codex: 'Codex',
      gemini: 'Gemini',
      opencode: 'OpenCode',
    },
    model: {
      title: 'MODEL',
      configureInCli: 'Configura els models a la configuració del CLI',
    },
    codexModel: {
      title: 'MODEL CODEX',
      gpt5CodexLow: 'gpt-5-codex low',
      gpt5CodexMedium: 'gpt-5-codex medium',
      gpt5CodexHigh: 'gpt-5-codex high',
      gpt5Minimal: 'GPT-5 Minimal',
      gpt5Low: 'GPT-5 Low',
      gpt5Medium: 'GPT-5 Medium',
      gpt5High: 'GPT-5 High',
    },
    context: {
      remaining: ({ percent }: { percent: number }) => `${percent}% restant`,
    },
    suggestion: {
      fileLabel: 'FITXER',
      folderLabel: 'CARPETA',
    },
    noMachinesAvailable: 'Sense màquines',
    abortConfirmTitle: 'Aturar la resposta actual?',
    abortConfirmMessage: "L'agent deixarà de treballar en aquesta resposta.",
    abortConfirmAction: 'Aturar',
    speechInput: {
      recording: 'Escoltant...',
      permissionTitle: 'Cal accés al micròfon',
      permissionMessage: "Permet l'accés al micròfon i al reconeixement de veu a la configuració del sistema.",
      permissionCancel: 'Cancel·lar',
      permissionOpenSettings: 'Obre la configuració',
      errorTitle: 'Error de reconeixement de veu',
      errorMessage: ({ error }: { error: string }) => `No s'ha pogut iniciar el reconeixement de veu (${error}).`,
      languageUnavailableTitle: "Paquet d'idioma no instal·lat",
      languageUnavailableMessage: "El paquet de reconeixement de veu per a l'idioma seleccionat no s'ha descarregat. Obriu els ajustos per instal·lar-lo o canvieu a l'anglès.",
      languageUnavailableCancel: 'Cancel·la',
      languageUnavailableOpenSettings: 'Obre els ajustos',
      languageUnavailableUseEnglish: "Usa l'anglès",
    },
  },

  machineLauncher: {
    showLess: 'Mostra menys',
    showAll: ({ count }: { count: number }) => `Mostra tots (${count} camins)`,
    enterCustomPath: 'Introdueix un camí personalitzat',
    offlineUnableToSpawn: 'No es pot crear una nova sessió, fora de línia',
  },

  sidebar: {
    sessionsTitle: 'Free',
  },

  toolView: {
    input: 'Entrada',
    output: 'Sortida',
  },

  tools: {
    fullView: {
      description: 'Descripció',
      inputParams: "Paràmetres d'entrada",
      output: 'Sortida',
      error: 'Error',
      completed: 'Eina completada amb èxit',
      noOutput: "No s'ha produït cap sortida",
      running: "L'eina s'està executant...",
      rawJsonDevMode: 'JSON en brut (mode desenvolupador)',
    },
    taskView: {
      initializing: "Inicialitzant l'agent...",
      moreTools: ({ count }: { count: number }) =>
        `+${count} més ${plural({ count, singular: 'eina', plural: 'eines' })}`,
    },
    multiEdit: {
      editNumber: ({ index, total }: { index: number; total: number }) =>
        `Edició ${index} de ${total}`,
      replaceAll: 'Reemplaça tot',
    },
    names: {
      task: 'Tasca',
      terminal: 'Terminal',
      searchFiles: 'Cerca fitxers',
      search: 'Cerca',
      searchContent: 'Cerca contingut',
      listFiles: 'Llista fitxers',
      planProposal: 'Proposta de pla',
      readFile: 'Llegeix fitxer',
      editFile: 'Edita fitxer',
      writeFile: 'Escriu fitxer',
      fetchUrl: 'Obté URL',
      readNotebook: 'Llegeix quadern',
      editNotebook: 'Edita quadern',
      todoList: 'Llista de tasques',
      webSearch: 'Cerca web',
      toolSearch: 'Cerca eines',
      reasoning: 'Raonament',
      applyChanges: 'Actualitza fitxer',
      viewDiff: 'Canvis del fitxer actual',
      question: 'Pregunta',
    },
    desc: {
      terminalCmd: ({ cmd }: { cmd: string }) => `Terminal(cmd: ${cmd})`,
      searchPattern: ({ pattern }: { pattern: string }) => `Cerca(patró: ${pattern})`,
      searchPath: ({ basename }: { basename: string }) => `Cerca(camí: ${basename})`,
      fetchUrlHost: ({ host }: { host: string }) => `Obté URL(url: ${host})`,
      editNotebookMode: ({ path, mode }: { path: string; mode: string }) =>
        `Edita quadern(fitxer: ${path}, mode: ${mode})`,
      todoListCount: ({ count }: { count: number }) => `Llista de tasques(quantitat: ${count})`,
      webSearchQuery: ({ query }: { query: string }) => `Cerca web(consulta: ${query})`,
      grepPattern: ({ pattern }: { pattern: string }) => `grep(patró: ${pattern})`,
      multiEditEdits: ({ path, count }: { path: string; count: number }) =>
        `${path} (${count} edicions)`,
      readingFile: ({ file }: { file: string }) => `Llegint ${file}`,
      writingFile: ({ file }: { file: string }) => `Escrivint ${file}`,
      modifyingFile: ({ file }: { file: string }) => `Modificant ${file}`,
      modifyingFiles: ({ count }: { count: number }) => `Modificant ${count} fitxers`,
      modifyingMultipleFiles: ({ file, count }: { file: string; count: number }) =>
        `${file} i ${count} més`,
      showingDiff: 'Mostrant canvis',
    },
    askUserQuestion: {
      submit: 'Envia resposta',
      multipleQuestions: ({ count }: { count: number }) =>
        `${count} ${plural({ count, singular: 'pregunta', plural: 'preguntes' })}`,
      other: 'Altres',
      otherDescription: 'Escriu la teva pròpia resposta',
      otherPlaceholder: 'Escriu la teva resposta...',
    },
  },

  files: {
    searchPlaceholder: 'Cerca fitxers...',
    detachedHead: 'HEAD separat',
    summary: ({ staged, unstaged }: { staged: number; unstaged: number }) =>
      `${staged} preparats • ${unstaged} sense preparar`,
    notRepo: 'No és un repositori git',
    notUnderGit: 'Aquest directori no està sota control de versions git',
    searching: 'Cercant fitxers...',
    noFilesFound: "No s'han trobat fitxers",
    noFilesInProject: 'No hi ha fitxers al projecte',
    tryDifferentTerm: 'Prova un terme de cerca diferent',
    searchResults: ({ count }: { count: number }) => `Resultats de la cerca (${count})`,
    projectRoot: 'Arrel del projecte',
    stagedChanges: ({ count }: { count: number }) => `Canvis preparats (${count})`,
    unstagedChanges: ({ count }: { count: number }) => `Canvis sense preparar (${count})`,
    // File viewer strings
    loadingFile: ({ fileName }: { fileName: string }) => `Carregant ${fileName}...`,
    binaryFile: 'Fitxer binari',
    cannotDisplayBinary: 'No es pot mostrar el contingut del fitxer binari',
    diff: 'Diferències',
    file: 'Fitxer',
    fileEmpty: 'El fitxer està buit',
    noChanges: 'No hi ha canvis a mostrar',
    browseTitle: 'Browse',
    browseFolderUp: 'Up',
    browseEmpty: 'This folder is empty',
    browseLoadFailed: 'Could not load this folder',
    browseNoPath:
      'Project path unavailable. Open this session from a machine where the CLI is connected.',
  },

  settingsAccount: {
    // Account settings screen
    accountInformation: 'Informació del compte',
    status: 'Estat',
    statusActive: 'Actiu',
    statusNotAuthenticated: 'No autenticat',
    anonymousId: 'ID anònim',
    publicId: 'ID públic',
    notAvailable: 'No disponible',
    linkNewDevice: 'Enllaça un nou dispositiu',
    linkNewDeviceSubtitle: 'Escaneja el codi QR per enllaçar el dispositiu',
    profile: 'Perfil',
    name: 'Nom',
    github: 'GitHub',
    tapToDisconnect: 'Toca per desconnectar',
    server: 'Servidor',
    backup: 'Còpia de seguretat',
    backupDescription:
      "La teva clau secreta és l'única manera de recuperar el teu compte. Desa-la en un lloc segur com un gestor de contrasenyes.",
    secretKey: 'Clau secreta',
    tapToReveal: 'Toca per revelar',
    tapToHide: 'Toca per ocultar',
    secretKeyLabel: 'CLAU SECRETA (TOCA PER COPIAR)',
    secretKeyCopied: 'Clau secreta copiada al porta-retalls. Desa-la en un lloc segur!',
    secretKeyCopyFailed: 'Ha fallat copiar la clau secreta',
    privacy: 'Privadesa',
    privacyDescription:
      "Ajuda a millorar l'aplicació compartint dades d'ús anònimes. No es recopila informació personal.",
    analytics: 'Analítiques',
    analyticsDisabled: 'No es comparteixen dades',
    analyticsEnabled: "Es comparteixen dades d'ús anònimes",
    dangerZone: 'Zona de perill',
    logout: 'Tanca la sessió',
    logoutSubtitle: 'Tanca la sessió i esborra les dades locals',
    logoutConfirm:
      "Estàs segur que vols tancar la sessió? Assegura't d'haver fet una còpia de seguretat de la teva clau secreta!",
  },

  settingsLanguage: {
    // Language settings screen
    title: 'Idioma',
    description:
      "Tria el teu idioma preferit per a la interfície de l'app. Això se sincronitzarà a tots els teus dispositius.",
    currentLanguage: 'Idioma actual',
    automatic: 'Automàtic',
    automaticSubtitle: 'Detecta des de la configuració del dispositiu',
    needsRestart: 'Idioma canviat',
    needsRestartMessage:
      "L'aplicació necessita reiniciar-se per aplicar la nova configuració d'idioma.",
    restartNow: 'Reinicia ara',
  },

  connectButton: {
    authenticate: 'Autentica el terminal',
    authenticateWithUrlPaste: "Autentica el terminal amb enganxat d'URL",
    pasteAuthUrl: "Enganxa l'URL d'autenticació del teu terminal",
  },

  updateBanner: {
    updateAvailable: 'Actualització disponible',
    pressToApply: "Prem per aplicar l'actualització",
    whatsNew: 'Novetats',
    seeLatest: 'Mira les últimes actualitzacions i millores',
    nativeUpdateAvailable: "Actualització de l'aplicació disponible",
    tapToUpdateAppStore: "Toca per actualitzar a l'App Store",
    tapToUpdatePlayStore: 'Toca per actualitzar a Play Store',
  },

  changelog: {
    // Used by the changelog screen
    version: ({ version }: { version: number }) => `Versió ${version}`,
    noEntriesAvailable: 'No hi ha entrades de registre de canvis disponibles.',
  },

  terminal: {
    // Used by terminal connection screens
    webBrowserRequired: 'Es requereix un navegador web',
    webBrowserRequiredDescription:
      "Els enllaços de connexió de terminal només es poden obrir en un navegador web per raons de seguretat. Utilitza l'escàner de codi QR o obre aquest enllaç en un ordinador.",
    processingConnection: 'Processant la connexió...',
    invalidConnectionLink: 'Enllaç de connexió no vàlid',
    invalidConnectionLinkDescription:
      "L'enllaç de connexió falta o no és vàlid. Comprova l'URL i torna-ho a provar.",
    connectTerminal: 'Connecta el terminal',
    terminalRequestDescription:
      'Un terminal està sol·licitant connectar-se al teu compte de Free Coder. Això permetrà al terminal enviar i rebre missatges de forma segura.',
    connectionDetails: 'Detalls de la connexió',
    publicKey: 'Clau pública',
    encryption: 'Xifratge',
    endToEndEncrypted: 'Xifrat punt a punt',
    acceptConnection: 'Accepta la connexió',
    createAccountAndAccept: 'Crea un compte i accepta',
    creatingAccount: 'Creant compte...',
    connecting: 'Connectant...',
    reject: 'Rebutja',
    security: 'Seguretat',
    securityFooter:
      "Aquest enllaç de connexió s'ha processat de forma segura al teu navegador i mai s'ha enviat a cap servidor. Les teves dades privades es mantindran segures i només tu pots desxifrar els missatges.",
    securityFooterDevice:
      "Aquesta connexió s'ha processat de forma segura al teu dispositiu i mai s'ha enviat a cap servidor. Les teves dades privades es mantindran segures i només tu pots desxifrar els missatges.",
    clientSideProcessing: 'Processament del costat del client',
    linkProcessedLocally: 'Enllaç processat localment al navegador',
    linkProcessedOnDevice: 'Enllaç processat localment al dispositiu',
  },

  modals: {
    // Used across connect flows and settings
    authenticateTerminal: 'Autentica el terminal',
    pasteUrlFromTerminal: "Enganxa l'URL d'autenticació del teu terminal",
    deviceLinkedSuccessfully: 'Dispositiu enllaçat amb èxit',
    terminalConnectedSuccessfully: 'Terminal connectat amb èxit',
    invalidAuthUrl: "URL d'autenticació no vàlida",
    developerMode: 'Mode desenvolupador',
    developerModeEnabled: 'Mode desenvolupador activat',
    developerModeDisabled: 'Mode desenvolupador desactivat',
    disconnectGithub: 'Desconnecta GitHub',
    disconnectGithubConfirm: 'Segur que vols desconnectar el teu compte de GitHub?',
    disconnectService: ({ service }: { service: string }) => `Desconnecta ${service}`,
    disconnectServiceConfirm: ({ service }: { service: string }) =>
      `Segur que vols desconnectar ${service} del teu compte?`,
    disconnect: 'Desconnecta',
    failedToConnectTerminal: 'Ha fallat connectar el terminal',
    cameraPermissionsRequiredToConnectTerminal:
      'Es requereixen permisos de càmera per connectar el terminal',
    failedToLinkDevice: 'Ha fallat enllaçar el dispositiu',
    cameraPermissionsRequiredToScanQr: 'Es requereixen permisos de càmera per escanejar codis QR',
  },

  navigation: {
    // Navigation titles and screen headers
    connectTerminal: 'Connecta el terminal',
    linkNewDevice: 'Enllaça un nou dispositiu',
    restoreWithSecretKey: 'Restaura amb clau secreta',
    whatsNew: 'Novetats',
    friends: 'Amics',
    importExistingAgentSessions: 'Importa sessions d\'agent existents',
    connectTo: ({ name }: { name: string }) => `Connecta a ${name}`,
    developerTools: 'Eines de desenvolupador',
    listComponentsDemo: 'Demo de components de llista',
    typography: 'Tipografia',
    colors: 'Colors',
    toolViewsDemo: 'Demo de vistes d\'eines',
    shimmerViewDemo: 'Demo de vista shimmer',
    multiTextInput: 'Entrada de text multilínia',
  },

  welcome: {
    // Main welcome screen for unauthenticated users
    title: 'Client mòbil de Codex i Claude Code',
    subtitle: "Xifrat punt a punt i el teu compte s'emmagatzema només al teu dispositiu.",
    createAccount: 'Crea un compte',
    linkOrRestoreAccount: 'Enllaça o restaura un compte',
    loginWithMobileApp: "Inicia sessió amb l'aplicació mòbil",
  },

  review: {
    // Used by utils/requestReview.ts
    enjoyingApp: "T'està agradant l'aplicació?",
    feedbackPrompt: 'Ens encantaria conèixer la teva opinió!',
    yesILoveIt: "Sí, m'encanta!",
    notReally: 'No gaire',
  },

  items: {
    // Used by Item component for copy toast
    copiedToClipboard: ({ label }: { label: string }) => `${label} copiat al porta-retalls`,
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
    offlineUnableToSpawn: 'El llançador està desactivat mentre la màquina està fora de línia',
    offlineHelp:
      "• Assegura't que l'ordinador estigui en línia\n• Executa `free daemon status` per diagnosticar\n• Fas servir l'última versió del CLI? Actualitza amb `npm install -g @saaskit-dev/free`",
    launchNewSessionInDirectory: 'Inicia una nova sessió al directori',
    enterCustomPath: 'Introdueix un camí personalitzat',
    previousSessions: 'Sessions anteriors (fins a 5 més recents)',
    machineNotFound: 'Màquina no trobada',
    stopDaemonConfirmTitle: 'Aturar el dimoni?',
    stopDaemonConfirmMessage: 'No podràs crear noves sessions en aquesta màquina fins que reiniciïs el dimoni al teu ordinador. Les sessions actuals es mantindran actives.',
    daemonStopped: 'Dimoni aturat',
    failedToStopDaemon: 'No s\'ha pogut aturar el dimoni. Pot ser que no estigui en execució.',
    renameMachine: 'Reanomena la màquina',
    renameMachineMessage: 'Dona un nom personalitzat a aquesta màquina. Deixa-ho buit per utilitzar el nom d\'amfitrió predeterminat.',
    enterMachineName: 'Introdueix el nom de la màquina',
    machineRenamed: 'Màquina reanomenada amb èxit',
    createDirectoryTitle: 'Crear directori?',
    createDirectoryMessage: ({ directory }: { directory: string }) => `El directori '${directory}' no existeix. Vols crear-lo?`,
    failedToStartSession: 'No s\'ha pogut iniciar la sessió. Assegura\'t que el dimoni s\'estigui executant a la màquina de destinació.',
    daemon: 'Dimoni',
    status: 'Estat',
    stopDaemon: 'Atura el dimoni',
    lastKnownPid: 'Últim PID conegut',
    lastKnownHttpPort: 'Últim port HTTP conegut',
    startedAt: 'Iniciat a',
    cliVersion: 'Versió del CLI',
    daemonStateVersion: "Versió de l'estat del dimoni",
    activeSessions: ({ count }: { count: number }) => `Sessions actives (${count})`,
    machineGroup: 'Màquina',
    host: 'Host',
    machineId: 'ID de la màquina',
    username: "Nom d'usuari",
    homeDirectory: 'Directori principal',
    platform: 'Plataforma',
    architecture: 'Arquitectura',
    lastSeen: 'Vist per última vegada',
    never: 'Mai',
    metadataVersion: 'Versió de les metadades',
    untitledSession: 'Sessió sense títol',
    back: 'Enrere',
  },

  message: {
    switchedToMode: ({ mode }: { mode: string }) => `S'ha canviat al mode ${mode}`,
    unknownEvent: 'Esdeveniment desconegut',
    usageLimitUntil: ({ time }: { time: string }) => `Límit d'ús assolit fins a ${time}`,
    unknownTime: 'temps desconegut',
    permissionRequest: ({ toolName }: { toolName: string }) => 'Permission request for ' + toolName,
    permissionMode: ({ mode }: { mode: string }) => 'Permission mode: ' + mode,
  },

  chatList: {
    pullToRefresh: 'Estira per actualitzar',
    releaseToRefresh: 'Deixa anar per actualitzar',
    refreshing: 'Actualitzant...',
    pullToLoadEarlier: 'Estira per carregar anteriors',
    releaseToLoadEarlier: 'Deixa anar per carregar anteriors',
    loadingEarlier: 'Carregant...',
    scrollToBottom: 'Anar a baix',
    newMessages: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? 'missatge nou' : 'missatges nous'}`,
    today: 'Avui',
    yesterday: 'Ahir',
  },

  codex: {
    // Codex permission dialog buttons
    permissions: {
      yesForSession: 'Sí, i no preguntar per aquesta sessió',
      stopAndExplain: 'Atura, i explica què fer',
    },
  },

  claude: {
    // Claude permission dialog buttons
    permissions: {
      yesAllowAllEdits: 'Sí, permet totes les edicions durant aquesta sessió',
      yesForTool: 'Sí, no tornis a preguntar per aquesta eina',
      noTellClaude: 'No, proporciona comentaris',
    },
  },

  textSelection: {
    // Text selection screen
    selectText: 'Seleccionar rang de text',
    title: 'Seleccionar text',
    noTextProvided: "No s'ha proporcionat text",
    textNotFound: 'Text no trobat o expirat',
    textCopied: 'Text copiat al porta-retalls',
    failedToCopy: "No s'ha pogut copiar el text al porta-retalls",
    noTextToCopy: 'No hi ha text disponible per copiar',
  },

  markdown: {
    // Markdown copy functionality
    codeCopied: 'Codi copiat',
    copyFailed: 'Error al copiar',
    mermaidRenderFailed: 'Error al renderitzar el diagrama mermaid',
  },

  artifacts: {
    title: 'Artefactes',
    countSingular: '1 artefacte',
    countPlural: ({ count }: { count: number }) => `${count} artefactes`,
    empty: 'Encara no hi ha artefactes',
    emptyDescription: 'Crea el teu primer artefacte per desar i organitzar contingut',
    new: 'Nou artefacte',
    edit: 'Edita artefacte',
    delete: 'Elimina',
    updateError: "No s'ha pogut actualitzar l'artefacte. Si us plau, torna-ho a provar.",
    notFound: 'Artefacte no trobat',
    discardChanges: 'Descartar els canvis?',
    discardChangesDescription: 'Tens canvis sense desar. Estàs segur que vols descartar-los?',
    deleteConfirm: 'Eliminar artefacte?',
    deleteConfirmDescription: "Aquest artefacte s'eliminarà permanentment.",
    titlePlaceholder: "Títol de l'artefacte",
    bodyPlaceholder: 'Escriu aquí el contingut...',
    save: 'Desa',
    saving: 'Desant...',
    loading: 'Carregant...',
    error: 'Error en carregar els artefactes',
    titleLabel: 'TÍTOL',
    bodyLabel: 'CONTINGUT',
    emptyFieldsError: 'Si us plau, introdueix un títol o contingut',
    createError: "No s'ha pogut crear l'artefacte. Si us plau, torna-ho a provar.",
  },

  friends: {
    // Friends feature
    title: 'Amics',
    manageFriends: 'Gestiona els teus amics i connexions',
    searchTitle: 'Buscar amics',
    pendingRequests: "Sol·licituds d'amistat",
    myFriends: 'Els meus amics',
    noFriendsYet: 'Encara no tens amics',
    findFriends: 'Buscar amics',
    remove: 'Eliminar',
    pendingRequest: 'Pendent',
    sentOn: ({ date }: { date: string }) => `Enviat el ${date}`,
    accept: 'Acceptar',
    reject: 'Rebutjar',
    addFriend: 'Afegir amic',
    alreadyFriends: 'Ja sou amics',
    requestPending: 'Sol·licitud pendent',
    searchInstructions: "Introdueix un nom d'usuari per buscar amics",
    searchPlaceholder: "Introdueix nom d'usuari...",
    searching: 'Buscant...',
    userNotFound: 'Usuari no trobat',
    noUserFound: "No s'ha trobat cap usuari amb aquest nom",
    checkUsername: "Si us plau, verifica el nom d'usuari i torna-ho a provar",
    howToFind: 'Com trobar amics',
    findInstructions:
      "Cerca amics pel seu nom d'usuari. Tant tu com el teu amic heu de tenir GitHub connectat per enviar sol·licituds d'amistat.",
    requestSent: "Sol·licitud d'amistat enviada!",
    requestAccepted: "Sol·licitud d'amistat acceptada!",
    requestRejected: "Sol·licitud d'amistat rebutjada",
    friendRemoved: 'Amic eliminat',
    confirmRemove: 'Eliminar amic',
    confirmRemoveMessage: 'Estàs segur que vols eliminar aquest amic?',
    cannotAddYourself: "No pots enviar-te una sol·licitud d'amistat a tu mateix",
    bothMustHaveGithub: 'Ambdós usuaris han de tenir GitHub connectat per ser amics',
    status: {
      none: 'No connectat',
      requested: 'Sol·licitud enviada',
      pending: 'Sol·licitud pendent',
      friend: 'Amics',
      rejected: 'Rebutjada',
    },
    acceptRequest: 'Acceptar sol·licitud',
    removeFriend: 'Eliminar dels amics',
    removeFriendConfirm: ({ name }: { name: string }) =>
      `Estàs segur que vols eliminar ${name} dels teus amics?`,
    requestSentDescription: ({ name }: { name: string }) =>
      `La teva sol·licitud d\'amistat ha estat enviada a ${name}`,
    requestFriendship: 'Sol·licitar amistat',
    cancelRequest: "Cancel·lar sol·licitud d'amistat",
    cancelRequestConfirm: ({ name }: { name: string }) =>
      `Cancel·lar la teva sol·licitud d\'amistat a ${name}?`,
    denyRequest: 'Rebutjar sol·licitud',
    nowFriendsWith: ({ name }: { name: string }) => `Ara ets amic de ${name}`,
  },

  usage: {
    // Usage panel strings
    today: 'Avui',
    last7Days: 'Últims 7 dies',
    last30Days: 'Últims 30 dies',
    totalTokens: 'Tokens totals',
    totalCost: 'Cost total',
    tokens: 'Tokens',
    cost: 'Cost',
    usageOverTime: 'Ús al llarg del temps',
    byModel: 'Per model',
    noData: "No hi ha dades d'ús disponibles",
  },

  dev: {
    appInformation: 'Informació de l\'app',
    version: 'Versió',
    buildNumber: 'Número de compilació',
    runtimeVersion: 'Versió de runtime',
    packageSource: 'Font del paquet',
    buildTime: 'Data de compilació',
    sdkVersion: 'Versió del SDK',
    platform: 'Plataforma',
    anonymousId: 'ID anònim',
    notAvailable: 'No disponible',
    debugOptions: 'Opcions de depuració',
    showDebugIds: 'Mostra IDs de depuració',
    showDebugIdsSubtitle: 'Mostra IDs de sessió, IDs d\'agent i JSON cru a la informació de la sessió',
    componentDemos: 'Demos de components',
    deviceInfo: 'Informació del dispositiu',
    deviceInfoSubtitle: 'Marges d\'àrea segura i paràmetres del dispositiu',
    listComponents: 'Components de llista',
    listComponentsSubtitle: 'Demo d\'Item, ItemGroup i ItemList',
    typography: 'Tipografia',
    typographySubtitle: 'Tots els estils tipogràfics',
    colors: 'Colors',
    colorsSubtitle: 'Paleta de colors i temes',
    messageDemos: 'Demos de missatges',
    messageDemosSubtitle: 'Diversos tipus de missatges i components',
    invertedListTest: 'Test de llista invertida',
    invertedListTestSubtitle: 'Test de FlatList invertida amb teclat',
    toolViews: 'Vistes d\'eines',
    toolViewsSubtitle: 'Components de visualització de crides d\'eines',
    shimmerView: 'Vista shimmer',
    shimmerViewSubtitle: 'Efectes de càrrega shimmer amb màscares',
    multiTextInput: 'Entrada de text multilínia',
    multiTextInputSubtitle: 'Entrada de text multilínia amb creixement automàtic',
    inputStyles: 'Estils d\'entrada',
    inputStylesSubtitle: '10+ variants d\'estils de camps d\'entrada',
    modalSystem: 'Sistema de modals',
    modalSystemSubtitle: 'Alertes, confirmacions i modals personalitzats',
    unitTests: 'Tests unitaris',
    unitTestsSubtitle: 'Executa tests en l\'entorn de l\'app',
    unistylesDemo: 'Demo d\'Unistyles',
    unistylesDemoSubtitle: 'Funcions i capacitats de React Native Unistyles',
    qrCodeTest: 'Test de codi QR',
    qrCodeTestSubtitle: 'Testa la generació de codis QR amb diferents paràmetres',
    testFeatures: 'Funcions de prova',
    testFeaturesFooter: 'Aquestes accions poden afectar l\'estabilitat de l\'app',
    claudeOAuthTest: 'Test OAuth de Claude',
    claudeOAuthTestSubtitle: 'Testa el flux d\'autenticació de Claude',
    testCrash: 'Test de bloqueig',
    testCrashSubtitle: 'Provoca un bloqueig de prova',
    testCrashConfirmTitle: 'Test de bloqueig',
    testCrashConfirmMessage: 'Això bloquejarà l\'app. Continuar?',
    crash: 'Bloquejar',
    clearCache: 'Netejar memòria cau',
    clearCacheSubtitle: 'Elimina totes les dades de la memòria cau',
    clearCacheConfirmTitle: 'Netejar memòria cau',
    clearCacheConfirmMessage: 'Segur que vols netejar totes les dades de la memòria cau? Els missatges es tornaran a obtenir del servidor.',
    clear: 'Netejar',
    cacheCleared: 'Memòria cau netejada',
    failedToClearCache: ({ error }: { error: string }) => `No s'ha pogut netejar la memòria cau: ${error}`,
    resetChangelog: 'Restablir registre de canvis',
    resetChangelogSubtitle: 'Mostra el bàner "Novetats" de nou',
    changelogReset: 'Registre de canvis restablert. Reinicia l\'app per veure el bàner.',
    resetAppState: 'Restablir estat de l\'app',
    resetAppStateSubtitle: 'Elimina totes les dades i preferències de l\'usuari',
    resetApp: 'Restablir app',
    resetAppConfirmMessage: 'Això eliminarà totes les dades. Estàs segur?',
    system: 'Sistema',
    purchases: 'Compres',
    purchasesSubtitle: 'Veure subscripcions i permisos',
    expoConstants: 'Constants d\'Expo',
    expoConstantsSubtitle: 'Veure expoConfig, manifests i constants del sistema',
    network: 'Xarxa',
    apiEndpoint: 'Endpoint de l\'API',
    socketIoStatus: 'Estat de Socket.IO',
    editApiEndpoint: 'Edita l\'endpoint de l\'API',
    enterServerUrl: 'Introdueix l\'URL del servidor:',
    serverUrlUpdated: 'URL del servidor actualitzada. Reinicia l\'app perquè els canvis tinguin efecte.',
    invalidUrl: 'URL no vàlida',
    invalidUrlDefault: 'Introdueix una URL vàlida',
    justNow: 'Ara mateix',
    secondsAgo: ({ seconds }: { seconds: number }) => `fa ${seconds}s`,
    minutesAgo: ({ minutes }: { minutes: number }) => `fa ${minutes}m`,
    hoursAgo: ({ hours }: { hours: number }) => `fa ${hours}h`,
    daysAgo: ({ days }: { days: number }) => `fa ${days}d`,
    connectedAgo: ({ time }: { time: string }) => `Connectat ${time}`,
    lastConnectedAgo: ({ time }: { time: string }) => `Última connexió ${time}`,
    connectingToServer: 'Connectant al servidor...',
    noConnectionInfo: 'Sense informació de connexió',
    done: 'Fet',
  },

  feed: {
    // Feed notifications for friend requests and acceptances
    friendRequestFrom: ({ name }: { name: string }) =>
      `${name} t'ha enviat una sol·licitud d'amistat`,
    friendRequestGeneric: "Nova sol·licitud d'amistat",
    friendAccepted: ({ name }: { name: string }) => `Ara ets amic de ${name}`,
    friendAcceptedGeneric: "Sol·licitud d'amistat acceptada",
  },

  voiceStatusBar: {
    connecting: 'Connectant...',
    reconnecting: 'Reconnectant...',
    active: 'Assistent de veu actiu',
    error: 'Error de connexió',
    default: 'Assistent de veu',
    tapToEnd: 'Toca per acabar',
  },
} as const;

export type TranslationsCa = typeof ca;
