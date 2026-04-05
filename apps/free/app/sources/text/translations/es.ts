import type { TranslationStructure } from '../_default';

/**
 * Spanish plural helper function
 * Spanish has 2 plural forms: singular, plural
 * @param options - Object containing count, singular, and plural forms
 * @returns The appropriate form based on Spanish plural rules
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
 * Spanish translations for the Free app
 * Must match the exact structure of the English translations
 */
export const es: TranslationStructure = {
  tabs: {
    // Tab navigation labels
    inbox: 'Bandeja',
    sessions: 'Sesiones',
    settings: 'Configuración',
  },

  inbox: {
    // Inbox screen
    emptyTitle: 'Bandeja vacía',
    emptyDescription: 'Conéctate con amigos para empezar a compartir sesiones',
    updates: 'Actualizaciones',
  },

  common: {
    // Simple string constants
    cancel: 'Cancelar',
    authenticate: 'Autenticar',
    save: 'Guardar',
    saveAs: 'Guardar como',
    error: 'Error',
    success: 'Éxito',
    ok: 'OK',
    continue: 'Continuar',
    back: 'Atrás',
    create: 'Crear',
    rename: 'Renombrar',
    reset: 'Restablecer',
    logout: 'Cerrar sesión',
    yes: 'Sí',
    no: 'No',
    discard: 'Descartar',
    version: 'Versión',
    copied: 'Copiado',
    copy: 'Copiar',
    scanning: 'Escaneando...',
    urlPlaceholder: 'https://ejemplo.com',
    home: 'Inicio',
    message: 'Mensaje',
    files: 'Archivos',
    fileViewer: 'Visor de archivos',
    loading: 'Cargando...',
    retry: 'Reintentar',
    delete: 'Eliminar',
    optional: 'opcional',
  },

  profile: {
    userProfile: 'Perfil de usuario',
    details: 'Detalles',
    firstName: 'Nombre',
    lastName: 'Apellido',
    username: 'Nombre de usuario',
    status: 'Estado',
  },

  status: {
    connected: 'conectado',
    connecting: 'conectando',
    disconnected: 'desconectado',
    error: 'error',
    authError: 'sesión expirada, cerrando sesión...',
    online: 'en línea',
    offline: 'desconectado',
    lastSeen: ({ time }: { time: string }) => `visto por última vez ${time}`,
    permissionRequired: 'permiso requerido',
    recoveryFailed: 'recuperación fallida',
    activeNow: 'Activo ahora',
    unknown: 'desconocido',
    machinesOnline: ({ count }: { count: number }) =>
      count === 0 ? 'sin máquinas' : `${count} ${count === 1 ? 'máquina' : 'máquinas'} en línea`,
  },

  time: {
    justNow: 'ahora mismo',
    minutesAgo: ({ count }: { count: number }) => `hace ${count} minuto${count !== 1 ? 's' : ''}`,
    hoursAgo: ({ count }: { count: number }) => `hace ${count} hora${count !== 1 ? 's' : ''}`,
  },

  connect: {
    restoreAccount: 'Restaurar cuenta',
    enterSecretKey: 'Ingresa tu clave secreta',
    invalidSecretKey: 'Clave secreta inválida. Verifica e intenta de nuevo.',
    enterUrlManually: 'Ingresar URL manualmente',
    connectName: ({ name }: { name: string }) => `Conectar ${name}`,
    runCommandInTerminal: 'Ejecuta el siguiente comando en tu terminal:',
  },

  restore: {
    enterSecretKeyInstruction: 'Introduce tu clave secreta para restaurar el acceso a tu cuenta.',
    secretKeyPlaceholder: 'XXXXX-XXXXX-XXXXX...',
    qrStep1: '1. Abre Free en tu dispositivo móvil',
    qrStep2: '2. Ve a Ajustes → Cuenta',
    qrStep3: '3. Toca "Vincular nuevo dispositivo"',
    qrStep4: '4. Escanea este código QR',
    restoreWithSecretKeyInstead: 'Restaurar con clave secreta',
  },

  support: {
    tierCoffee: 'Compañero de café',
    tierCoffeePrice: '¥12',
    tierCoffeePeriod: '/mes',
    tierCoffeeDescription: 'Un café para impulsar el desarrollo',
    tierCoffeeFeature1: 'Sin insignia de patrocinador en la app',
    tierCoffeeFeature2: 'Acceso anticipado a nuevas funciones',
    tierBuilder: 'Constructor',
    tierBuilderPrice: '¥38',
    tierBuilderPeriod: '/mes',
    tierBuilderDescription: 'Moldea el futuro de la programación juntos',
    tierBuilderFeature1: 'Todos los beneficios de Compañero de café',
    tierBuilderFeature2: 'Canal exclusivo de Discord',
    tierBuilderFeature3: 'Q&A mensual 1 a 1',
    tierPioneer: 'Pionero',
    tierPioneerPrice: '¥98',
    tierPioneerPeriod: '/mes',
    tierPioneerDescription: 'Una experiencia exclusiva para pioneros',
    tierPioneerFeature1: 'Todos los beneficios de Constructor',
    tierPioneerFeature2: 'Acceso anticipado a funciones experimentales',
    tierPioneerFeature3: 'Prioridad en solicitudes personalizadas',
    tierPioneerFeature4: 'Consultoría técnica dedicada',
    title: 'Soporte',
    thankYouTitle: 'Gracias',
    purchaseSuccess: ({ name }: { name: string }) => `Ahora eres「${name}」. ¡Gracias por tu apoyo!`,
    purchaseFailed: 'Compra fallida',
    unknownError: 'Error desconocido, inténtalo de nuevo',
    thankYouMessage: 'Gracias por tu apoyo',
    thankYouDescription: 'Eres un valioso Constructor. Tu apoyo impulsa nuestra innovación continua.',
    supportDevelopment: 'Apoyar el desarrollo',
    supportDescription: 'Tu apoyo impulsa nuestra innovación continua. Elige un plan que te funcione y moldea el futuro de la programación juntos.',
    recommended: 'Recomendado',
    processing: 'Procesando...',
    joinTier: ({ name, price, period }: { name: string; price: string; period: string }) => `Unirse a ${name} · ${price}${period}`,
    cancellableSecurePayment: 'Cancela en cualquier momento · Pago seguro',
  },

  settings: {
    title: 'Configuración',
    connectedAccounts: 'Cuentas conectadas',
    connectAccount: 'Conectar cuenta',
    github: 'GitHub',
    machines: 'Máquinas',
    features: 'Características',
    social: 'Social',
    account: 'Cuenta',
    accountSubtitle: 'Gestiona los detalles de tu cuenta',
    appearance: 'Apariencia',
    appearanceSubtitle: 'Personaliza como se ve la app',
    featuresTitle: 'Características',
    featuresSubtitle: 'Habilitar o deshabilitar funciones de la aplicación',
    developer: 'Desarrollador',
    exitDeveloperMode: 'Salir del modo desarrollador',
    developerTools: 'Herramientas de desarrollador',
    about: 'Acerca de',
    aboutFooter:
      'Free Coder es un cliente móvil para Codex y Claude Code. Todo está cifrado de extremo a extremo y tu cuenta se guarda solo en tu dispositivo. No está afiliado con Anthropic.',
    whatsNew: 'Novedades',
    whatsNewSubtitle: 'Ve las últimas actualizaciones y mejoras',
    reportIssue: 'Reportar un problema',
    privacyPolicy: 'Política de privacidad',
    termsOfService: 'Términos de servicio',
    eula: 'EULA',
    scanQrCodeToAuthenticate: 'Escanea el código QR para autenticarte',
    githubConnected: ({ login }: { login: string }) => `Conectado como @${login}`,
    connectGithubAccount: 'Conecta tu cuenta de GitHub',
    claudeAuthSuccess: 'Conectado exitosamente con Claude',
    exchangingTokens: 'Intercambiando tokens...',
    usage: 'Uso',
    usageSubtitle: 'Ver tu uso de API y costos',
    supportUs: 'Únete a nosotros',
    supportUsSubtitlePro: 'Eres un Constructor 🎉',
    supportUsSubtitle: 'Sé parte del futuro',

    // Dynamic settings messages
    accountConnected: ({ service }: { service: string }) => `Cuenta de ${service} conectada`,
    machineStatus: ({ name, status }: { name: string; status: 'online' | 'offline' }) =>
      `${name} está ${status === 'online' ? 'en línea' : 'desconectado'}`,
    featureToggled: ({ feature, enabled }: { feature: string; enabled: boolean }) =>
      `${feature} ${enabled ? 'habilitada' : 'deshabilitada'}`,
  },

  settingsAppearance: {
    // Appearance settings screen
    theme: 'Tema',
    themeDescription: 'Elige tu esquema de colores preferido',
    themeOptions: {
      adaptive: 'Adaptativo',
      light: 'Claro',
      dark: 'Oscuro',
    },
    themeDescriptions: {
      adaptive: 'Seguir configuración del sistema',
      light: 'Usar siempre tema claro',
      dark: 'Usar siempre tema oscuro',
    },
    display: 'Pantalla',
    displayDescription: 'Controla diseño y espaciado',
    inlineToolCalls: 'Llamadas a herramientas en línea',
    inlineToolCallsDescription: 'Mostrar llamadas a herramientas directamente en mensajes de chat',
    expandTodoLists: 'Expandir listas de tareas',
    expandTodoListsDescription: 'Mostrar todas las tareas en lugar de solo cambios',
    showLineNumbersInDiffs: 'Mostrar números de línea en diferencias',
    showLineNumbersInDiffsDescription: 'Mostrar números de línea en diferencias de código',
    showLineNumbersInToolViews: 'Mostrar números de línea en vistas de herramientas',
    showLineNumbersInToolViewsDescription:
      'Mostrar números de línea en diferencias de vistas de herramientas',
    wrapLinesInDiffs: 'Ajustar líneas en diferencias',
    wrapLinesInDiffsDescription:
      'Ajustar líneas largas en lugar de desplazamiento horizontal en vistas de diferencias',
    alwaysShowContextSize: 'Mostrar siempre tamaño del contexto',
    alwaysShowContextSizeDescription:
      'Mostrar uso del contexto incluso cuando no esté cerca del límite',
    avatarStyle: 'Estilo de avatar',
    avatarStyleDescription: 'Elige la apariencia del avatar de sesión',
    avatarOptions: {
      pixelated: 'Pixelado',
      gradient: 'Gradiente',
      brutalist: 'Brutalista',
    },
    showFlavorIcons: 'Mostrar íconos de proveedor de IA',
    showFlavorIconsDescription: 'Mostrar íconos del proveedor de IA en los avatares de sesión',
    compactSessionView: 'Vista compacta de sesiones',
    compactSessionViewDescription: 'Mostrar sesiones activas en un diseño más compacto',
  },

  settingsFeatures: {
    // Features settings screen
    experiments: 'Experimentos',
    experimentsDescription:
      'Habilitar características experimentales que aún están en desarrollo. Estas características pueden ser inestables o cambiar sin aviso.',
    experimentalFeatures: 'Características experimentales',
    experimentalFeaturesEnabled: 'Características experimentales habilitadas',
    experimentalFeaturesDisabled: 'Usando solo características estables',
    webFeatures: 'Características web',
    webFeaturesDescription: 'Características disponibles solo en la versión web de la aplicación.',
    enterToSend: 'Enter para enviar',
    enterToSendEnabled: 'Presiona Enter para enviar (Shift+Enter para una nueva línea)',
    enterToSendDisabled: 'Enter inserta una nueva línea',
    commandPalette: 'Paleta de comandos',
    commandPaletteEnabled: 'Presione ⌘K para abrir',
    commandPaletteDisabled: 'Acceso rápido a comandos deshabilitado',
    markdownCopyV2: 'Markdown Copy v2',
    markdownCopyV2Subtitle: 'Pulsación larga abre modal de copiado',
    hideInactiveSessions: 'Ocultar sesiones inactivas',
    hideInactiveSessionsSubtitle: 'Muestra solo los chats activos en tu lista',
    enhancedSessionWizard: 'Asistente de sesión mejorado',
    enhancedSessionWizardEnabled: 'Lanzador de sesión con perfil activo',
    enhancedSessionWizardDisabled: 'Usando el lanzador de sesión estándar',

},

  errors: {
    networkError: 'Error de conexión',
    serverError: 'Error del servidor',
    unknownError: 'Error desconocido',
    connectionTimeout: 'Se agotó el tiempo de conexión',
    authenticationFailed: 'Falló la autenticación',
    permissionDenied: 'Permiso denegado',
    fileNotFound: 'Archivo no encontrado',
    invalidFormat: 'Formato inválido',
    operationFailed: 'Operación falló',
    tryAgain: 'Intenta de nuevo',
    contactSupport: 'Contacta soporte si el problema persiste',
    sessionNotFound: 'Sesión no encontrada',
    voiceSessionFailed: 'Falló al iniciar sesión de voz',
    voiceServiceUnavailable: 'El servicio de voz no está disponible temporalmente',
    voiceNotConfigured: 'Voice feature is not configured. Please contact support.',
    voiceNotInitialized:
      'Voice service failed to initialize. Please restart the app and try again.',
    voiceMicPermissionWeb:
      'Microphone access is required for voice. Please allow microphone permission in your browser settings.',
    voiceTokenRejected: 'Voice service is not available on this server.',
    oauthInitializationFailed: 'Falló al inicializar el flujo OAuth',
    tokenStorageFailed: 'Falló al almacenar los tokens de autenticación',
    oauthStateMismatch: 'Falló la validación de seguridad. Inténtalo de nuevo',
    tokenExchangeFailed: 'Falló al intercambiar el código de autorización',
    oauthAuthorizationDenied: 'La autorización fue denegada',
    webViewLoadFailed: 'Falló al cargar la página de autenticación',
    failedToLoadProfile: 'No se pudo cargar el perfil de usuario',
    userNotFound: 'Usuario no encontrado',
    sessionDeleted: 'La sesión ha sido eliminada',
    sessionDeletedDescription: 'Esta sesión ha sido eliminada permanentemente',

    // Error functions with context
    fieldError: ({ field, reason }: { field: string; reason: string }) => `${field}: ${reason}`,
    validationError: ({ field, min, max }: { field: string; min: number; max: number }) =>
      `${field} debe estar entre ${min} y ${max}`,
    retryIn: ({ seconds }: { seconds: number }) =>
      `Intenta en ${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`,
    errorWithCode: ({ message, code }: { message: string; code: number | string }) =>
      `${message} (Error ${code})`,
    disconnectServiceFailed: ({ service }: { service: string }) =>
      `Falló al desconectar ${service}`,
    connectServiceFailed: ({ service }: { service: string }) =>
      `No se pudo conectar ${service}. Por favor, inténtalo de nuevo.`,
    failedToLoadFriends: 'No se pudo cargar la lista de amigos',
    failedToAcceptRequest: 'No se pudo aceptar la solicitud de amistad',
    failedToRejectRequest: 'No se pudo rechazar la solicitud de amistad',
    failedToRemoveFriend: 'No se pudo eliminar al amigo',
    searchFailed: 'La búsqueda falló. Por favor, intenta de nuevo.',
    failedToSendRequest: 'No se pudo enviar la solicitud de amistad',
  },

  newSession: {
    // Used by new-session screen and launch flows
    title: 'Iniciar nueva sesión',
    noMachinesFound:
      'No se encontraron máquinas. Inicia una sesión de Free en tu computadora primero.',
    allMachinesOffline: 'Todas las máquinas están desconectadas',
    machineDetails: 'Ver detalles de la máquina →',
    directoryDoesNotExist: 'Directorio no encontrado',
    createDirectoryConfirm: ({ directory }: { directory: string }) =>
      `El directorio ${directory} no existe. ¿Deseas crearlo?`,
    sessionStarted: 'Sesión iniciada',
    sessionStartedMessage: 'La sesión se ha iniciado correctamente.',
    sessionSpawningFailed: 'Falló la creación de sesión - no se devolvió ID de sesión.',
    failedToStart:
      'Falló al iniciar sesión. Asegúrate de que el daemon esté ejecutándose en la máquina objetivo.',
    sessionTimeout:
      'El inicio de sesión expiró. La máquina puede ser lenta o el daemon puede no estar respondiendo.',
    notConnectedToServer: 'No conectado al servidor. Verifica tu conexión a internet.',
    startingSession: 'Iniciando sesión...',
    startNewSessionInFolder: 'Nueva sesión aquí',
    noMachineSelected: 'Por favor, selecciona una máquina para iniciar la sesión',
    noPathSelected: 'Por favor, selecciona un directorio para iniciar la sesión',
    sessionType: {
      title: 'Tipo de sesión',
      simple: 'Simple',
      worktree: 'Worktree',
      comingSoon: 'Próximamente',
    },
    worktree: {
      creating: ({ name }: { name: string }) => `Creando worktree '${name}'...`,
      notGitRepo: 'Los worktrees requieren un repositorio git',
      failed: ({ error }: { error: string }) => `Error al crear worktree: ${error}`,
      success: 'Worktree creado exitosamente',
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
    inputPlaceholder: '¿En qué te gustaría trabajar?',
    capabilityDiscoveryNotice: 'Envía tu primer mensaje para cargar modos, modelos y comandos.',
  },

  agentPicker: {
    headerTitle: 'Seleccionar agente',
    heroEyebrow: 'Selector de implementación',
    heroTitle: 'Elige el entorno de ejecución con el que deseas comenzar.',
    heroDescription:
      'Cada opción a continuación se descubre a partir de las implementaciones registradas en la máquina seleccionada. Las entradas clásicas y ACP se mantienen separadas a propósito.',
    experimentalSection: 'Experimental',
    experimentalCaption: 'Agentes opcionales detrás de la configuración de experimentos.',
    noAgentsTitle: 'No hay agentes disponibles',
    noAgentsDescription: 'Esta máquina no reportó ninguna implementación ejecutable.',
    tagAcp: 'ACP',
    tagClassic: 'Clásico',
    tagAnthropic: 'Anthropic',
    tagOpenAI: 'OpenAI',
    tagGoogle: 'Google',
    tagTerminal: 'Terminal',
    tagExperimental: 'Experimental',
  },

  machinePicker: {
    headerTitle: 'Seleccionar máquina',
    noMachinesAvailable: 'No hay máquinas disponibles',
    online: 'en línea',
    offline: 'desconectado',
    searchPlaceholder: 'Escribe para filtrar máquinas...',
    recentSection: 'Máquinas recientes',
    favoritesSection: 'Máquinas favoritas',
    allSection: 'Todos los dispositivos',
  },

  pathPicker: {
    headerTitle: 'Seleccionar ruta',
    noMachineSelected: 'Ninguna máquina seleccionada',
    enterPath: 'Ingresar ruta',
    enterPathPlaceholder: 'Ingresar ruta (ej. /home/user/projects)',
    recentPaths: 'Rutas recientes',
    suggestedPaths: 'Rutas sugeridas',
    browse: 'Explorar',
    browseError: 'No se pudo cargar el directorio',
    emptyDirectory: 'Sin subdirectorios',
  },

  sessionHistory: {
    // Used by session history screen
    title: 'Historial de sesiones',
    empty: 'No se encontraron sesiones',
    today: 'Hoy',
    yesterday: 'Ayer',
    daysAgo: ({ count }: { count: number }) => `hace ${count} ${count === 1 ? 'día' : 'días'}`,
    viewAll: 'Ver todas las sesiones',
  },

  session: {
    inputPlaceholder: 'Escriba un mensaje ...',
    sendFailed: 'Error al enviar. Toca para reintentar.',
    sendBlockedServerDisconnected: 'Servidor desconectado, no se puede enviar el mensaje',
    sendBlockedDaemonOffline: 'Sesión sin conexión, no se puede enviar el mensaje',
    addImage: 'Añadir imagen',
    pickLatestPhoto: 'Última foto',
    chooseFromLibrary: 'Elegir de la biblioteca',
    latestPhotoUnavailable:
      'No se pudo cargar una foto. Permite el acceso a la biblioteca o añade fotos.',
  },

  commandPalette: {
    placeholder: 'Escriba un comando o busque...',
  },

  server: {
    // Used by Server Configuration screen (app/(app)/server.tsx)
    serverConfiguration: 'Configuración del servidor',
    enterServerUrl: 'Ingresa una URL de servidor',
    notValidFreeServer: 'No es un servidor Free válido',
    changeServer: 'Cambiar servidor',
    continueWithServer: '¿Continuar con este servidor?',
    resetToDefault: 'Restablecer por defecto',
    resetServerDefault: '¿Restablecer servidor por defecto?',
    validating: 'Validando...',
    validatingServer: 'Validando servidor...',
    serverReturnedError: 'El servidor devolvió un error',
    failedToConnectToServer: 'Falló al conectar con el servidor',
    currentlyUsingCustomServer: 'Actualmente usando servidor personalizado',
    customServerUrlLabel: 'URL del servidor personalizado',
    advancedFeatureFooter:
      'Esta es una característica avanzada. Solo cambia el servidor si sabes lo que haces. Necesitarás cerrar sesión e iniciarla nuevamente después de cambiar servidores.',
  },

  sessionInfo: {
    // Used by Session Info screen (app/(app)/session/[id]/info.tsx)
    killSession: 'Terminar sesión',
    killSessionConfirm: '¿Seguro que quieres terminar esta sesión?',
    archiveSession: 'Archivar sesión',
    archiveSessionConfirm: '¿Seguro que quieres archivar esta sesión?',
    freeSessionIdCopied: 'ID de sesión de Free copiado al portapapeles',
    failedToCopySessionId: 'Falló al copiar ID de sesión de Free',
    freeSessionId: 'ID de sesión de Free',
    agentSessionId: 'ID de sesión de Claude Code',
    agentSessionIdCopied: 'ID de sesión de Claude Code copiado al portapapeles',
    aiProvider: 'Proveedor de IA',
    failedToCopyAgentSessionId: 'Falló al copiar ID de sesión de Claude Code',
    metadataCopied: 'Metadatos copiados al portapapeles',
    failedToCopyMetadata: 'Falló al copiar metadatos',
    failedToKillSession: 'Falló al terminar sesión',
    failedToArchiveSession: 'Falló al archivar sesión',
    connectionStatus: 'Estado de conexión',
    created: 'Creado',
    lastUpdated: 'Última actualización',
    sequence: 'Secuencia',
    quickActions: 'Acciones rápidas',
    viewMachine: 'Ver máquina',
    viewMachineSubtitle: 'Ver detalles de máquina y sesiones',
    killSessionSubtitle: 'Terminar inmediatamente la sesión',
    archiveSessionSubtitle: 'Archivar esta sesión y detenerla',
    recoveryFailedArchiveSubtitle: 'Esta sesión no se pudo recuperar después de un fallo',
    metadata: 'Metadatos',
    host: 'Host',
    path: 'Ruta',
    operatingSystem: 'Sistema operativo',
    processId: 'ID del proceso',
    freeHome: 'Directorio de Free',
    copyMetadata: 'Copiar metadatos',
    agentState: 'Estado del agente',
    controlledByUser: 'Controlado por el usuario',
    pendingRequests: 'Solicitudes pendientes',
    activity: 'Actividad',
    thinking: 'Pensando',
    thinkingSince: 'Pensando desde',
    cliVersion: 'Versión del CLI',
    cliVersionOutdated: 'Actualización de CLI requerida',
    cliVersionOutdatedMessage: ({
      currentVersion,
      requiredVersion,
    }: {
      currentVersion: string;
      requiredVersion: string;
    }) => `Versión ${currentVersion} instalada. Actualice a ${requiredVersion} o posterior`,
    updateCliInstructions:
      'Por favor ejecute npm install -g @saaskit-dev/free',
    restartAgent: 'Reinicio forzado del agente',
    restartAgentConfirm: 'Esto terminará el proceso del agente actual e iniciará uno nuevo. La sesión y el historial de conversación se conservarán.',
    restartAgentSubtitle: 'Terminar y reiniciar el proceso del agente',
    restartAgentSuccess: 'El proceso del agente se está reiniciando.',
    failedToRestartAgent: 'Error al reiniciar el agente',
    deleteSession: 'Eliminar sesión',
    deleteSessionSubtitle: 'Eliminar permanentemente esta sesión',
    deleteSessionConfirm: '¿Eliminar sesión permanentemente?',
    deleteSessionWarning:
      'Esta acción no se puede deshacer. Todos los mensajes y datos asociados con esta sesión se eliminarán permanentemente.',
    failedToDeleteSession: 'Error al eliminar la sesión',
    sessionDeleted: 'Sesión eliminada exitosamente',
    clearCache: 'Limpiar caché',
    clearCacheSubtitle: 'Limpiar datos de caché local para esta sesión',
    clearCacheConfirm: '¿Limpiar todos los datos de caché para esta sesión? Los mensajes se volverán a obtener del servidor.',
    clearCacheSuccess: 'Caché limpiada exitosamente',
    clearCacheFailed: 'Error al limpiar la caché',
  },

  components: {
    emptyMainScreen: {
      // Used by EmptyMainScreen component
      readyToCode: '¿Listo para programar?',
      installCli: 'Instale el Free CLI',
      runIt: 'Ejecútelo',
      scanQrCode: 'Escanee el código QR',
      openCamera: 'Abrir cámara',
    },
  },

  agentInput: {
    permissionMode: {
      title: 'MODO DE PERMISOS',
      readOnly: 'Solo lectura',
      acceptEdits: 'Aceptar ediciones',
      yolo: 'YOLO',
      badgeReadOnly: 'Solo lectura',
      badgeAcceptEdits: 'Aceptar ediciones',
      badgeYolo: 'YOLO',
    },
    agentTitle: 'Agente',
    agentModeTitle: 'Modo de agente',
    experimentalSection: 'Experimental',
    agent: {
      claude: 'Claude',
      codex: 'Codex',
      gemini: 'Gemini',
      opencode: 'OpenCode',
    },
    model: {
      title: 'MODELO',
      configureInCli: 'Configurar modelos en la configuración del CLI',
    },
    codexModel: {
      title: 'MODELO CODEX',
      gpt5CodexLow: 'gpt-5-codex low',
      gpt5CodexMedium: 'gpt-5-codex medium',
      gpt5CodexHigh: 'gpt-5-codex high',
      gpt5Minimal: 'GPT-5 Minimal',
      gpt5Low: 'GPT-5 Low',
      gpt5Medium: 'GPT-5 Medium',
      gpt5High: 'GPT-5 High',
    },
    context: {
      remaining: ({ percent }: { percent: number }) => `${percent}% restante`,
    },
    suggestion: {
      fileLabel: 'ARCHIVO',
      folderLabel: 'CARPETA',
    },
    noMachinesAvailable: 'Sin máquinas',
    abortConfirmTitle: '¿Detener la respuesta actual?',
    abortConfirmMessage: 'El agente dejará de trabajar en esta respuesta.',
    abortConfirmAction: 'Detener',
    abortTimedOut:
      'La solicitud de detención ha superado el tiempo de espera. Comprueba la conexión e inténtalo de nuevo.',
    speechInput: {
      recording: 'Escuchando...',
      permissionTitle: 'Se requiere acceso al micrófono',
      permissionMessage: 'Permite el acceso al micrófono y al reconocimiento de voz en los ajustes del sistema.',
      permissionCancel: 'Cancelar',
      permissionOpenSettings: 'Abrir ajustes',
      errorTitle: 'Error de reconocimiento de voz',
      errorMessage: ({ error }: { error: string }) => `No se pudo iniciar el reconocimiento de voz (${error}).`,
      languageUnavailableTitle: 'Paquete de idioma no instalado',
      languageUnavailableMessage: 'El paquete de reconocimiento de voz para el idioma seleccionado no está descargado. Abre ajustes para instalarlo o cambia al inglés.',
      languageUnavailableCancel: 'Cancelar',
      languageUnavailableOpenSettings: 'Abrir ajustes',
      languageUnavailableUseEnglish: 'Usar inglés',
    },
  },

  machineLauncher: {
    showLess: 'Mostrar menos',
    showAll: ({ count }: { count: number }) => `Mostrar todos (${count} rutas)`,
    enterCustomPath: 'Ingresar ruta personalizada',
    offlineUnableToSpawn: 'No se puede crear nueva sesión, desconectado',
  },

  sidebar: {
    sessionsTitle: 'Free',
  },

  toolView: {
    input: 'Entrada',
    output: 'Salida',
  },

  tools: {
    fullView: {
      description: 'Descripción',
      inputParams: 'Parámetros de entrada',
      output: 'Salida',
      error: 'Error',
      completed: 'Herramienta completada exitosamente',
      noOutput: 'No se produjo salida',
      running: 'La herramienta está ejecutándose...',
      rawJsonDevMode: 'JSON crudo (modo desarrollador)',
    },
    taskView: {
      initializing: 'Inicializando agente...',
      moreTools: ({ count }: { count: number }) =>
        `+${count} más ${plural({ count, singular: 'herramienta', plural: 'herramientas' })}`,
    },
    multiEdit: {
      editNumber: ({ index, total }: { index: number; total: number }) =>
        `Edición ${index} de ${total}`,
      replaceAll: 'Reemplazar todo',
    },
    names: {
      task: 'Tarea',
      terminal: 'Terminal',
      searchFiles: 'Buscar archivos',
      search: 'Buscar',
      searchContent: 'Buscar contenido',
      listFiles: 'Listar archivos',
      planProposal: 'Propuesta de plan',
      readFile: 'Leer archivo',
      editFile: 'Editar archivo',
      writeFile: 'Escribir archivo',
      fetchUrl: 'Obtener URL',
      readNotebook: 'Leer cuaderno',
      editNotebook: 'Editar cuaderno',
      todoList: 'Lista de tareas',
      webSearch: 'Búsqueda web',
      toolSearch: 'Buscar herramientas',
      reasoning: 'Razonamiento',
      applyChanges: 'Actualizar archivo',
      viewDiff: 'Cambios del archivo actual',
      question: 'Pregunta',
    },
    desc: {
      terminalCmd: ({ cmd }: { cmd: string }) => `Terminal(cmd: ${cmd})`,
      searchPattern: ({ pattern }: { pattern: string }) => `Buscar(patrón: ${pattern})`,
      searchPath: ({ basename }: { basename: string }) => `Buscar(ruta: ${basename})`,
      fetchUrlHost: ({ host }: { host: string }) => `Obtener URL(url: ${host})`,
      editNotebookMode: ({ path, mode }: { path: string; mode: string }) =>
        `Editar cuaderno(archivo: ${path}, modo: ${mode})`,
      todoListCount: ({ count }: { count: number }) => `Lista de tareas(cantidad: ${count})`,
      webSearchQuery: ({ query }: { query: string }) => `Búsqueda web(consulta: ${query})`,
      grepPattern: ({ pattern }: { pattern: string }) => `grep(patrón: ${pattern})`,
      multiEditEdits: ({ path, count }: { path: string; count: number }) =>
        `${path} (${count} ediciones)`,
      readingFile: ({ file }: { file: string }) => `Leyendo ${file}`,
      writingFile: ({ file }: { file: string }) => `Escribiendo ${file}`,
      modifyingFile: ({ file }: { file: string }) => `Modificando ${file}`,
      modifyingFiles: ({ count }: { count: number }) => `Modificando ${count} archivos`,
      modifyingMultipleFiles: ({ file, count }: { file: string; count: number }) =>
        `${file} y ${count} más`,
      showingDiff: 'Mostrando cambios',
    },
    askUserQuestion: {
      submit: 'Enviar respuesta',
      multipleQuestions: ({ count }: { count: number }) =>
        `${count} ${plural({ count, singular: 'pregunta', plural: 'preguntas' })}`,
      other: 'Otro',
      otherDescription: 'Escribe tu propia respuesta',
      otherPlaceholder: 'Escribe tu respuesta...',
    },
  },

  files: {
    searchPlaceholder: 'Buscar archivos...',
    detachedHead: 'HEAD separado',
    summary: ({ staged, unstaged }: { staged: number; unstaged: number }) =>
      `${staged} preparados • ${unstaged} sin preparar`,
    notRepo: 'No es un repositorio git',
    notUnderGit: 'Este directorio no está bajo control de versiones git',
    searching: 'Buscando archivos...',
    noFilesFound: 'No se encontraron archivos',
    noFilesInProject: 'No hay archivos en el proyecto',
    tryDifferentTerm: 'Intente un término de búsqueda diferente',
    searchResults: ({ count }: { count: number }) => `Resultados de búsqueda (${count})`,
    projectRoot: 'Raíz del proyecto',
    stagedChanges: ({ count }: { count: number }) => `Cambios preparados (${count})`,
    unstagedChanges: ({ count }: { count: number }) => `Cambios sin preparar (${count})`,
    // File viewer strings
    loadingFile: ({ fileName }: { fileName: string }) => `Cargando ${fileName}...`,
    binaryFile: 'Archivo binario',
    cannotDisplayBinary: 'No se puede mostrar el contenido del archivo binario',
    tapImageToZoom: 'Toca la imagen para ampliarla',
    diff: 'Diferencias',
    file: 'Archivo',
    fileEmpty: 'El archivo está vacío',
    noChanges: 'No hay cambios que mostrar',
    failedToDecodeContent: 'No se pudo decodificar el contenido del archivo',
    failedToReadFile: 'No se pudo leer el archivo',
    failedToLoadFile: 'No se pudo cargar el archivo',
    pathCopied: 'Ruta copiada',
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
  },

  settingsAccount: {
    // Account settings screen
    accountInformation: 'Información de la cuenta',
    status: 'Estado',
    statusActive: 'Activo',
    statusNotAuthenticated: 'No autenticado',
    anonymousId: 'ID anónimo',
    publicId: 'ID público',
    notAvailable: 'No disponible',
    linkNewDevice: 'Vincular nuevo dispositivo',
    linkNewDeviceSubtitle: 'Escanear código QR para vincular dispositivo',
    profile: 'Perfil',
    name: 'Nombre',
    github: 'GitHub',
    tapToDisconnect: 'Toque para desconectar',
    server: 'Servidor',
    backup: 'Copia de seguridad',
    backupDescription:
      'Tu clave secreta es la única forma de recuperar tu cuenta. Guárdala en un lugar seguro como un administrador de contraseñas.',
    secretKey: 'Clave secreta',
    tapToReveal: 'Toca para revelar',
    tapToHide: 'Toca para ocultar',
    secretKeyLabel: 'CLAVE SECRETA (TOCA PARA COPIAR)',
    secretKeyCopied: 'Clave secreta copiada al portapapeles. ¡Guárdala en un lugar seguro!',
    secretKeyCopyFailed: 'Falló al copiar la clave secreta',
    privacy: 'Privacidad',
    privacyDescription:
      'Ayude a mejorar la aplicación compartiendo datos de uso anónimos. No se recopila información personal.',
    analytics: 'Analíticas',
    analyticsDisabled: 'No se comparten datos',
    analyticsEnabled: 'Se comparten datos de uso anónimos',
    dangerZone: 'Zona peligrosa',
    logout: 'Cerrar sesión',
    logoutSubtitle: 'Cerrar sesión y limpiar datos locales',
    logoutConfirm:
      '¿Seguro que quieres cerrar sesión? ¡Asegúrate de haber guardado tu clave secreta!',
  },

  settingsLanguage: {
    // Language settings screen
    title: 'Idioma',
    description:
      'Elige tu idioma preferido para la interfaz de la aplicación. Esto se sincronizará en todos tus dispositivos.',
    currentLanguage: 'Idioma actual',
    automatic: 'Automático',
    automaticSubtitle: 'Detectar desde configuración del dispositivo',
    needsRestart: 'Idioma cambiado',
    needsRestartMessage:
      'La aplicación necesita reiniciarse para aplicar la nueva configuración de idioma.',
    restartNow: 'Reiniciar ahora',
  },

  connectButton: {
    authenticate: 'Autenticar terminal',
    authenticateWithUrlPaste: 'Autenticar terminal con pegado de URL',
    pasteAuthUrl: 'Pega la URL de autenticación de tu terminal',
  },

  updateBanner: {
    updateAvailable: 'Actualización disponible',
    pressToApply: 'Presione para aplicar la actualización',
    whatsNew: 'Novedades',
    seeLatest: 'Ver las últimas actualizaciones y mejoras',
    nativeUpdateAvailable: 'Actualización de la aplicación disponible',
    tapToUpdateAppStore: 'Toque para actualizar en App Store',
    tapToUpdatePlayStore: 'Toque para actualizar en Play Store',
  },

  changelog: {
    // Used by the changelog screen
    version: ({ version }: { version: number }) => `Versión ${version}`,
    noEntriesAvailable: 'No hay entradas de registro de cambios disponibles.',
  },

  terminal: {
    // Used by terminal connection screens
    webBrowserRequired: 'Se requiere navegador web',
    webBrowserRequiredDescription:
      'Los enlaces de conexión de terminal solo pueden abrirse en un navegador web por razones de seguridad. Usa el escáner de código QR o abre este enlace en una computadora.',
    processingConnection: 'Procesando conexión...',
    invalidConnectionLink: 'Enlace de conexión inválido',
    invalidConnectionLinkDescription:
      'El enlace de conexión falta o es inválido. Verifica la URL e intenta nuevamente.',
    connectTerminal: 'Conectar terminal',
    terminalRequestDescription:
      'Un terminal está solicitando conectarse a tu cuenta de Free Coder. Esto permitirá al terminal enviar y recibir mensajes de forma segura.',
    connectionDetails: 'Detalles de conexión',
    publicKey: 'Clave pública',
    encryption: 'Cifrado',
    endToEndEncrypted: 'Cifrado de extremo a extremo',
    acceptConnection: 'Aceptar conexión',
    createAccountAndAccept: 'Crear cuenta y aceptar',
    creatingAccount: 'Creando cuenta...',
    connecting: 'Conectando...',
    reject: 'Rechazar',
    security: 'Seguridad',
    securityFooter:
      'Este enlace de conexión fue procesado de forma segura en tu navegador y nunca fue enviado a ningún servidor. Tus datos privados permanecerán seguros y solo tú puedes descifrar los mensajes.',
    securityFooterDevice:
      'Esta conexión fue procesada de forma segura en tu dispositivo y nunca fue enviada a ningún servidor. Tus datos privados permanecerán seguros y solo tú puedes descifrar los mensajes.',
    clientSideProcessing: 'Procesamiento del lado del cliente',
    linkProcessedLocally: 'Enlace procesado localmente en el navegador',
    linkProcessedOnDevice: 'Enlace procesado localmente en el dispositivo',
  },

  modals: {
    // Used across connect flows and settings
    authenticateTerminal: 'Autenticar terminal',
    pasteUrlFromTerminal: 'Pega la URL de autenticación de tu terminal',
    deviceLinkedSuccessfully: 'Dispositivo vinculado exitosamente',
    terminalConnectedSuccessfully: 'Terminal conectado exitosamente',
    invalidAuthUrl: 'URL de autenticación inválida',
    developerMode: 'Modo desarrollador',
    developerModeEnabled: 'Modo desarrollador habilitado',
    developerModeDisabled: 'Modo desarrollador deshabilitado',
    disconnectGithub: 'Desconectar GitHub',
    disconnectGithubConfirm: '¿Seguro que quieres desconectar tu cuenta de GitHub?',
    disconnectService: ({ service }: { service: string }) => `Desconectar ${service}`,
    disconnectServiceConfirm: ({ service }: { service: string }) =>
      `¿Seguro que quieres desconectar ${service} de tu cuenta?`,
    disconnect: 'Desconectar',
    failedToConnectTerminal: 'Falló al conectar terminal',
    cameraPermissionsRequiredToConnectTerminal:
      'Se requieren permisos de cámara para conectar terminal',
    failedToLinkDevice: 'Falló al vincular dispositivo',
    cameraPermissionsRequiredToScanQr: 'Se requieren permisos de cámara para escanear códigos QR',
  },

  navigation: {
    // Navigation titles and screen headers
    connectTerminal: 'Conectar terminal',
    linkNewDevice: 'Vincular nuevo dispositivo',
    restoreWithSecretKey: 'Restaurar con clave secreta',
    whatsNew: 'Novedades',
    friends: 'Amigos',
    importExistingAgentSessions: 'Importar sesiones de agente existentes',
    connectTo: ({ name }: { name: string }) => `Conectar a ${name}`,
    developerTools: 'Herramientas de desarrollador',
    listComponentsDemo: 'Demo de componentes de lista',
    typography: 'Tipografía',
    colors: 'Colores',
    toolViewsDemo: 'Demo de vistas de herramientas',
    shimmerViewDemo: 'Demo de vista shimmer',
    multiTextInput: 'Entrada de texto multilínea',
  },

  welcome: {
    // Main welcome screen for unauthenticated users
    title: 'Cliente móvil de Codex y Claude Code',
    subtitle: 'Cifrado de extremo a extremo y tu cuenta se guarda solo en tu dispositivo.',
    createAccount: 'Crear cuenta',
    linkOrRestoreAccount: 'Vincular o restaurar cuenta',
    loginWithMobileApp: 'Iniciar sesión con aplicación móvil',
  },

  review: {
    // Used by utils/requestReview.ts
    enjoyingApp: '¿Disfrutando la aplicación?',
    feedbackPrompt: '¡Nos encantaría escuchar tus comentarios!',
    yesILoveIt: '¡Sí, me encanta!',
    notReally: 'No realmente',
  },

  items: {
    // Used by Item component for copy toast
    copiedToClipboard: ({ label }: { label: string }) => `${label} copiado al portapapeles`,
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
    offlineUnableToSpawn: 'El lanzador está deshabilitado mientras la máquina está desconectada',
    offlineHelp:
      '• Asegúrate de que tu computadora esté en línea\n• Ejecuta `free daemon status` para diagnosticar\n• ¿Estás usando la última versión del CLI? Actualiza con `npm install -g @saaskit-dev/free`',
    launchNewSessionInDirectory: 'Iniciar nueva sesión en directorio',
    enterCustomPath: 'Introducir ruta personalizada',
    previousSessions: 'Sesiones anteriores (hasta 5 más recientes)',
    machineNotFound: 'Máquina no encontrada',
    stopDaemonConfirmTitle: '¿Detener el daemon?',
    stopDaemonConfirmMessage: 'No podrás crear nuevas sesiones en esta máquina hasta que reinicies el daemon en tu computadora. Las sesiones actuales seguirán activas.',
    daemonStopped: 'Daemon detenido',
    failedToStopDaemon: 'Error al detener el daemon. Puede que no esté en ejecución.',
    renameMachine: 'Renombrar máquina',
    renameMachineMessage: 'Dale un nombre personalizado a esta máquina. Déjalo vacío para usar el nombre de host predeterminado.',
    enterMachineName: 'Introducir nombre de máquina',
    machineRenamed: 'Máquina renombrada con éxito',
    createDirectoryTitle: '¿Crear directorio?',
    createDirectoryMessage: ({ directory }: { directory: string }) => `El directorio '${directory}' no existe. ¿Deseas crearlo?`,
    failedToStartSession: 'Error al iniciar la sesión. Asegúrate de que el daemon esté ejecutándose en la máquina de destino.',
    daemon: 'Demonio',
    status: 'Estado',
    stopDaemon: 'Detener daemon',
    lastKnownPid: 'Último PID conocido',
    lastKnownHttpPort: 'Último puerto HTTP conocido',
    startedAt: 'Iniciado en',
    cliVersion: 'Versión del CLI',
    daemonStateVersion: 'Versión del estado del daemon',
    activeSessions: ({ count }: { count: number }) => `Sesiones activas (${count})`,
    machineGroup: 'Máquina',
    host: 'Host',
    machineId: 'ID de máquina',
    username: 'Nombre de usuario',
    homeDirectory: 'Directorio principal',
    platform: 'Plataforma',
    architecture: 'Arquitectura',
    lastSeen: 'Visto por última vez',
    never: 'Nunca',
    metadataVersion: 'Versión de metadatos',
    untitledSession: 'Sesión sin título',
    back: 'Atrás',
  },

  message: {
    switchedToMode: ({ mode }: { mode: string }) => `Cambiado al modo ${mode}`,
    unknownEvent: 'Evento desconocido',
    usageLimitUntil: ({ time }: { time: string }) => `Límite de uso alcanzado hasta ${time}`,
    unknownTime: 'tiempo desconocido',
    permissionRequest: ({ toolName }: { toolName: string }) => 'Permission request for ' + toolName,
    permissionMode: ({ mode }: { mode: string }) => 'Permission mode: ' + mode,
  },

  chatList: {
    pullToRefresh: 'Desliza para actualizar',
    releaseToRefresh: 'Suelta para actualizar',
    refreshing: 'Actualizando...',
    pullToLoadEarlier: 'Desliza para cargar anteriores',
    releaseToLoadEarlier: 'Suelta para cargar anteriores',
    loadingEarlier: 'Cargando...',
    navPanelPartialHint:
      'Mostrando solo los mensajes cargados. Desliza hacia arriba para cargar los anteriores.',
    scrollToBottom: 'Ir abajo',
    newMessages: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? 'mensaje nuevo' : 'mensajes nuevos'}`,
    today: 'Hoy',
    yesterday: 'Ayer',
  },

  codex: {
    // Codex permission dialog buttons
    permissions: {
      yesForSession: 'Sí, y no preguntar por esta sesión',
      stopAndExplain: 'Detener, y explicar qué hacer',
    },
  },

  claude: {
    // Claude permission dialog buttons
    permissions: {
      yesAllowAllEdits: 'Sí, permitir todas las ediciones durante esta sesión',
      yesForTool: 'Sí, no volver a preguntar para esta herramienta',
      noTellClaude: 'No, proporcionar comentarios',
    },
  },

  textSelection: {
    // Text selection screen
    selectText: 'Seleccionar rango de texto',
    title: 'Seleccionar texto',
    noTextProvided: 'No se proporcionó texto',
    textNotFound: 'Texto no encontrado o expirado',
    textCopied: 'Texto copiado al portapapeles',
    failedToCopy: 'Error al copiar el texto al portapapeles',
    noTextToCopy: 'No hay texto disponible para copiar',
  },

  markdown: {
    // Markdown copy functionality
    codeCopied: 'Código copiado',
    copyFailed: 'Error al copiar',
    mermaidRenderFailed: 'Error al renderizar el diagrama mermaid',
  },

  artifacts: {
    // Artifacts feature
    title: 'Artefactos',
    countSingular: '1 artefacto',
    countPlural: ({ count }: { count: number }) => `${count} artefactos`,
    empty: 'No hay artefactos aún',
    emptyDescription: 'Crea tu primer artefacto para comenzar',
    new: 'Nuevo artefacto',
    edit: 'Editar artefacto',
    delete: 'Eliminar',
    updateError: 'No se pudo actualizar el artefacto. Por favor, intenta de nuevo.',
    notFound: 'Artefacto no encontrado',
    discardChanges: '¿Descartar cambios?',
    discardChangesDescription:
      'Tienes cambios sin guardar. ¿Estás seguro de que quieres descartarlos?',
    deleteConfirm: '¿Eliminar artefacto?',
    deleteConfirmDescription: 'Esta acción no se puede deshacer',
    titleLabel: 'TÍTULO',
    titlePlaceholder: 'Ingresa un título para tu artefacto',
    bodyLabel: 'CONTENIDO',
    bodyPlaceholder: 'Escribe tu contenido aquí...',
    emptyFieldsError: 'Por favor, ingresa un título o contenido',
    createError: 'No se pudo crear el artefacto. Por favor, intenta de nuevo.',
    save: 'Guardar',
    saving: 'Guardando...',
    loading: 'Cargando artefactos...',
    error: 'Error al cargar el artefacto',
  },

  friends: {
    // Friends feature
    title: 'Amigos',
    manageFriends: 'Administra tus amigos y conexiones',
    searchTitle: 'Buscar amigos',
    pendingRequests: 'Solicitudes de amistad',
    myFriends: 'Mis amigos',
    noFriendsYet: 'Aún no tienes amigos',
    findFriends: 'Buscar amigos',
    remove: 'Eliminar',
    pendingRequest: 'Pendiente',
    sentOn: ({ date }: { date: string }) => `Enviado el ${date}`,
    accept: 'Aceptar',
    reject: 'Rechazar',
    addFriend: 'Agregar amigo',
    alreadyFriends: 'Ya son amigos',
    requestPending: 'Solicitud pendiente',
    searchInstructions: 'Ingresa un nombre de usuario para buscar amigos',
    searchPlaceholder: 'Ingresa nombre de usuario...',
    searching: 'Buscando...',
    userNotFound: 'Usuario no encontrado',
    noUserFound: 'No se encontró ningún usuario con ese nombre',
    checkUsername: 'Por favor, verifica el nombre de usuario e intenta de nuevo',
    howToFind: 'Cómo encontrar amigos',
    findInstructions:
      'Busca amigos por su nombre de usuario. Tanto tú como tu amigo deben tener GitHub conectado para enviar solicitudes de amistad.',
    requestSent: '¡Solicitud de amistad enviada!',
    requestAccepted: '¡Solicitud de amistad aceptada!',
    requestRejected: 'Solicitud de amistad rechazada',
    friendRemoved: 'Amigo eliminado',
    confirmRemove: 'Eliminar amigo',
    confirmRemoveMessage: '¿Estás seguro de que quieres eliminar a este amigo?',
    cannotAddYourself: 'No puedes enviarte una solicitud de amistad a ti mismo',
    bothMustHaveGithub: 'Ambos usuarios deben tener GitHub conectado para ser amigos',
    status: {
      none: 'No conectado',
      requested: 'Solicitud enviada',
      pending: 'Solicitud pendiente',
      friend: 'Amigos',
      rejected: 'Rechazada',
    },
    acceptRequest: 'Aceptar solicitud',
    removeFriend: 'Eliminar de amigos',
    removeFriendConfirm: ({ name }: { name: string }) =>
      `¿Estás seguro de que quieres eliminar a ${name} de tus amigos?`,
    requestSentDescription: ({ name }: { name: string }) =>
      `Tu solicitud de amistad ha sido enviada a ${name}`,
    requestFriendship: 'Solicitar amistad',
    cancelRequest: 'Cancelar solicitud de amistad',
    cancelRequestConfirm: ({ name }: { name: string }) =>
      `¿Cancelar tu solicitud de amistad a ${name}?`,
    denyRequest: 'Rechazar solicitud',
    nowFriendsWith: ({ name }: { name: string }) => `Ahora eres amigo de ${name}`,
  },

  usage: {
    // Usage panel strings
    today: 'Hoy',
    last7Days: 'Últimos 7 días',
    last30Days: 'Últimos 30 días',
    totalTokens: 'Tokens totales',
    totalCost: 'Costo total',
    tokens: 'Tokens',
    cost: 'Costo',
    usageOverTime: 'Uso a lo largo del tiempo',
    byModel: 'Por modelo',
    noData: 'No hay datos de uso disponibles',
  },

  dev: {
    appInformation: 'Información de la app',
    version: 'Versión',
    buildNumber: 'Número de compilación',
    runtimeVersion: 'Versión de runtime',
    packageSource: 'Fuente del paquete',
    buildTime: 'Fecha de compilación',
    sdkVersion: 'Versión del SDK',
    platform: 'Plataforma',
    anonymousId: 'ID anónimo',
    notAvailable: 'No disponible',
    debugOptions: 'Opciones de depuración',
    showDebugIds: 'Mostrar IDs de depuración',
    showDebugIdsSubtitle: 'Mostrar IDs de sesión, IDs de agente y JSON sin procesar en la información de la sesión',
    componentDemos: 'Demos de componentes',
    deviceInfo: 'Información del dispositivo',
    deviceInfoSubtitle: 'Márgenes de área segura y parámetros del dispositivo',
    listComponents: 'Componentes de lista',
    listComponentsSubtitle: 'Demo de Item, ItemGroup e ItemList',
    typography: 'Tipografía',
    typographySubtitle: 'Todos los estilos tipográficos',
    colors: 'Colores',
    colorsSubtitle: 'Paleta de colores y temas',
    messageDemos: 'Demos de mensajes',
    messageDemosSubtitle: 'Varios tipos de mensajes y componentes',
    invertedListTest: 'Prueba de lista invertida',
    invertedListTestSubtitle: 'Prueba de FlatList invertida con teclado',
    toolViews: 'Vistas de herramientas',
    toolViewsSubtitle: 'Componentes de visualización de llamadas de herramientas',
    shimmerView: 'Vista shimmer',
    shimmerViewSubtitle: 'Efectos de carga shimmer con máscaras',
    multiTextInput: 'Entrada de texto multilínea',
    multiTextInputSubtitle: 'Entrada de texto multilínea con crecimiento automático',
    inputStyles: 'Estilos de entrada',
    inputStylesSubtitle: '10+ variantes de estilos de campos de entrada',
    modalSystem: 'Sistema de modales',
    modalSystemSubtitle: 'Alertas, confirmaciones y modales personalizados',
    unitTests: 'Pruebas unitarias',
    unitTestsSubtitle: 'Ejecutar pruebas en el entorno de la app',
    unistylesDemo: 'Demo de Unistyles',
    unistylesDemoSubtitle: 'Funciones y capacidades de React Native Unistyles',
    qrCodeTest: 'Prueba de código QR',
    qrCodeTestSubtitle: 'Probar la generación de códigos QR con diferentes parámetros',
    testFeatures: 'Funciones de prueba',
    testFeaturesFooter: 'Estas acciones pueden afectar la estabilidad de la app',
    claudeOAuthTest: 'Prueba de OAuth de Claude',
    claudeOAuthTestSubtitle: 'Probar el flujo de autenticación de Claude',
    testCrash: 'Prueba de bloqueo',
    testCrashSubtitle: 'Provocar un bloqueo de prueba',
    testCrashConfirmTitle: 'Prueba de bloqueo',
    testCrashConfirmMessage: 'Esto bloqueará la app. ¿Continuar?',
    crash: 'Bloquear',
    clearCache: 'Limpiar caché',
    clearCacheSubtitle: 'Eliminar todos los datos en caché',
    clearCacheConfirmTitle: 'Limpiar caché',
    clearCacheConfirmMessage: '¿Estás seguro de que deseas limpiar todos los datos en caché? Los mensajes se volverán a obtener del servidor.',
    clear: 'Limpiar',
    cacheCleared: 'Caché limpiado',
    failedToClearCache: ({ error }: { error: string }) => `Error al limpiar la caché: ${error}`,
    resetChangelog: 'Restablecer registro de cambios',
    resetChangelogSubtitle: 'Mostrar el banner de "Novedades" de nuevo',
    changelogReset: 'Registro de cambios restablecido. Reinicia la app para ver el banner.',
    resetAppState: 'Restablecer estado de la app',
    resetAppStateSubtitle: 'Eliminar todos los datos y preferencias del usuario',
    resetApp: 'Restablecer app',
    resetAppConfirmMessage: 'Esto eliminará todos los datos. ¿Estás seguro?',
    system: 'Sistema',
    purchases: 'Compras',
    purchasesSubtitle: 'Ver suscripciones y permisos',
    expoConstants: 'Constantes de Expo',
    expoConstantsSubtitle: 'Ver expoConfig, manifests y constantes del sistema',
    network: 'Red',
    apiEndpoint: 'Endpoint de API',
    socketIoStatus: 'Estado de Socket.IO',
    editApiEndpoint: 'Editar endpoint de API',
    enterServerUrl: 'Ingresa la URL del servidor:',
    serverUrlUpdated: 'URL del servidor actualizada. Reinicia la app para que los cambios surtan efecto.',
    invalidUrl: 'URL inválida',
    invalidUrlDefault: 'Por favor ingresa una URL válida',
    justNow: 'Ahora mismo',
    secondsAgo: ({ seconds }: { seconds: number }) => `hace ${seconds}s`,
    minutesAgo: ({ minutes }: { minutes: number }) => `hace ${minutes}m`,
    hoursAgo: ({ hours }: { hours: number }) => `hace ${hours}h`,
    daysAgo: ({ days }: { days: number }) => `hace ${days}d`,
    connectedAgo: ({ time }: { time: string }) => `Conectado ${time}`,
    lastConnectedAgo: ({ time }: { time: string }) => `Última conexión ${time}`,
    connectingToServer: 'Conectando al servidor...',
    noConnectionInfo: 'Sin información de conexión',
    done: 'Hecho',
  },

  feed: {
    // Feed notifications for friend requests and acceptances
    friendRequestFrom: ({ name }: { name: string }) => `${name} te envió una solicitud de amistad`,
    friendRequestGeneric: 'Nueva solicitud de amistad',
    friendAccepted: ({ name }: { name: string }) => `Ahora eres amigo de ${name}`,
    friendAcceptedGeneric: 'Solicitud de amistad aceptada',
  },

  voiceStatusBar: {
    connecting: 'Conectando...',
    reconnecting: 'Reconectando...',
    active: 'Asistente de voz activo',
    error: 'Error de conexión',
    default: 'Asistente de voz',
    tapToEnd: 'Toca para finalizar',
  },
} as const;

export type TranslationsEs = typeof es;
