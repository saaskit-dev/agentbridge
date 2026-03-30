import type { TranslationStructure } from '../_default';

/**
 * Portuguese plural helper function
 * Portuguese (Brazilian) has 2 plural forms: singular, plural
 * @param options - Object containing count, singular, and plural forms
 * @returns The appropriate form based on Portuguese plural rules
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
 * Portuguese (Brazilian) translations for the Free app
 * Must match the exact structure of the English translations
 */
export const pt: TranslationStructure = {
  tabs: {
    // Tab navigation labels
    inbox: 'Caixa de entrada',
    sessions: 'Sessões',
    settings: 'Configurações',
  },

  inbox: {
    // Inbox screen
    emptyTitle: 'Caixa de entrada vazia',
    emptyDescription: 'Conecte-se com amigos para começar a compartilhar sessões',
    updates: 'Atualizações',
  },

  common: {
    // Simple string constants
    cancel: 'Cancelar',
    authenticate: 'Autenticar',
    save: 'Salvar',
    saveAs: 'Salvar como',
    error: 'Erro',
    success: 'Sucesso',
    ok: 'OK',
    continue: 'Continuar',
    back: 'Voltar',
    create: 'Criar',
    rename: 'Renomear',
    reset: 'Redefinir',
    logout: 'Sair',
    yes: 'Sim',
    no: 'Não',
    discard: 'Descartar',
    version: 'Versão',
    copied: 'Copiado',
    copy: 'Copiar',
    scanning: 'Escaneando...',
    urlPlaceholder: 'https://exemplo.com',
    home: 'Início',
    message: 'Mensagem',
    files: 'Arquivos',
    fileViewer: 'Visualizador de arquivos',
    loading: 'Carregando...',
    retry: 'Tentar novamente',
    delete: 'Excluir',
    optional: 'Opcional',
  },

  profile: {
    userProfile: 'Perfil do usuário',
    details: 'Detalhes',
    firstName: 'Nome',
    lastName: 'Sobrenome',
    username: 'Nome de usuário',
    status: 'Status',
  },

  status: {
    connected: 'conectado',
    connecting: 'conectando',
    disconnected: 'desconectado',
    error: 'erro',
    authError: 'sessão expirada, saindo...',
    online: 'online',
    offline: 'offline',
    lastSeen: ({ time }: { time: string }) => `visto por último ${time}`,
    permissionRequired: 'permissão necessária',
    recoveryFailed: 'recuperação falhou',
    activeNow: 'Ativo agora',
    unknown: 'desconhecido',
    machinesOnline: ({ count }: { count: number }) =>
      count === 0 ? 'sem máquinas' : `${count} ${count === 1 ? 'máquina' : 'máquinas'} online`,
  },

  time: {
    justNow: 'agora mesmo',
    minutesAgo: ({ count }: { count: number }) => `há ${count} minuto${count !== 1 ? 's' : ''}`,
    hoursAgo: ({ count }: { count: number }) => `há ${count} hora${count !== 1 ? 's' : ''}`,
  },

  connect: {
    restoreAccount: 'Restaurar conta',
    enterSecretKey: 'Por favor, insira uma chave secreta',
    invalidSecretKey: 'Chave secreta inválida. Verifique e tente novamente.',
    enterUrlManually: 'Inserir URL manualmente',
    connectName: ({ name }: { name: string }) => `Conectar ${name}`,
    runCommandInTerminal: 'Execute o seguinte comando no seu terminal:',
  },

  restore: {
    enterSecretKeyInstruction: 'Insira sua chave secreta para restaurar o acesso à sua conta.',
    secretKeyPlaceholder: 'XXXXX-XXXXX-XXXXX...',
    qrStep1: '1. Abra o Free no seu dispositivo móvel',
    qrStep2: '2. Vá para Configurações → Conta',
    qrStep3: '3. Toque em "Vincular novo dispositivo"',
    qrStep4: '4. Escaneie este código QR',
    restoreWithSecretKeyInstead: 'Restaurar com chave secreta',
  },

  support: {
    tierCoffee: 'Parceiro de café',
    tierCoffeePrice: '¥12',
    tierCoffeePeriod: '/mês',
    tierCoffeeDescription: 'Um café para impulsionar o desenvolvimento',
    tierCoffeeFeature1: 'Sem emblema de patrocinador no app',
    tierCoffeeFeature2: 'Acesso antecipado a novos recursos',
    tierBuilder: 'Construtor',
    tierBuilderPrice: '¥38',
    tierBuilderPeriod: '/mês',
    tierBuilderDescription: 'Molde o futuro da programação juntos',
    tierBuilderFeature1: 'Todos os benefícios de Parceiro de café',
    tierBuilderFeature2: 'Canal exclusivo no Discord',
    tierBuilderFeature3: 'Q&A mensal 1 a 1',
    tierPioneer: 'Pioneiro',
    tierPioneerPrice: '¥98',
    tierPioneerPeriod: '/mês',
    tierPioneerDescription: 'Uma experiência exclusiva para pioneiros',
    tierPioneerFeature1: 'Todos os benefícios de Construtor',
    tierPioneerFeature2: 'Acesso antecipado a recursos experimentais',
    tierPioneerFeature3: 'Prioridade em solicitações personalizadas',
    tierPioneerFeature4: 'Consultoria técnica dedicada',
    title: 'Apoio',
    thankYouTitle: 'Obrigado',
    purchaseSuccess: ({ name }: { name: string }) => `Você agora é um「${name}」. Obrigado pelo seu apoio!`,
    purchaseFailed: 'Compra falhou',
    unknownError: 'Erro desconhecido, tente novamente',
    thankYouMessage: 'Obrigado pelo seu apoio',
    thankYouDescription: 'Você é um valioso Construtor. Seu apoio impulsiona nossa inovação contínua.',
    supportDevelopment: 'Apoiar o desenvolvimento',
    supportDescription: 'Seu apoio impulsiona nossa inovação contínua. Escolha um plano que funcione para você e molde o futuro da programação juntos.',
    recommended: 'Recomendado',
    processing: 'Processando...',
    joinTier: ({ name, price, period }: { name: string; price: string; period: string }) => `Juntar-se a ${name} · ${price}${period}`,
    cancellableSecurePayment: 'Cancele a qualquer momento · Pagamento seguro',
  },

  settings: {
    title: 'Configurações',
    connectedAccounts: 'Contas conectadas',
    connectAccount: 'Conectar conta',
    github: 'GitHub',
    machines: 'Máquinas',
    features: 'Recursos',
    social: 'Social',
    account: 'Conta',
    accountSubtitle: 'Gerencie os detalhes da sua conta',
    appearance: 'Aparência',
    appearanceSubtitle: 'Personalize a aparência do aplicativo',
    featuresTitle: 'Recursos',
    featuresSubtitle: 'Ativar ou desativar recursos do aplicativo',
    developer: 'Desenvolvedor',
    exitDeveloperMode: 'Sair do modo desenvolvedor',
    developerTools: 'Ferramentas de desenvolvedor',
    about: 'Sobre',
    aboutFooter:
      'Free Coder é um cliente móvel para Codex e Claude Code. É totalmente criptografado ponta a ponta e sua conta é armazenada apenas no seu dispositivo. Não é afiliado à Anthropic.',
    whatsNew: 'Novidades',
    whatsNewSubtitle: 'Veja as atualizações e melhorias mais recentes',
    reportIssue: 'Relatar um problema',
    privacyPolicy: 'Política de privacidade',
    termsOfService: 'Termos de serviço',
    eula: 'EULA',
    scanQrCodeToAuthenticate: 'Escaneie o código QR para autenticar',
    githubConnected: ({ login }: { login: string }) => `Conectado como @${login}`,
    connectGithubAccount: 'Conecte sua conta GitHub',
    claudeAuthSuccess: 'Conectado ao Claude com sucesso',
    exchangingTokens: 'Trocando tokens...',
    usage: 'Uso',
    usageSubtitle: 'Visualizar uso da API e custos',
    supportUs: 'Junte-se a nós',
    supportUsSubtitlePro: 'Você é um Construtor 🎉',
    supportUsSubtitle: 'Seja parte do futuro',

    // Dynamic settings messages
    accountConnected: ({ service }: { service: string }) => `Conta ${service} conectada`,
    machineStatus: ({ name, status }: { name: string; status: 'online' | 'offline' }) =>
      `${name} está ${status === 'online' ? 'online' : 'offline'}`,
    featureToggled: ({ feature, enabled }: { feature: string; enabled: boolean }) =>
      `${feature} ${enabled ? 'ativado' : 'desativado'}`,
  },

  settingsAppearance: {
    // Appearance settings screen
    theme: 'Tema',
    themeDescription: 'Escolha seu esquema de cores preferido',
    themeOptions: {
      adaptive: 'Adaptativo',
      light: 'Claro',
      dark: 'Escuro',
    },
    themeDescriptions: {
      adaptive: 'Usar configurações do sistema',
      light: 'Sempre usar tema claro',
      dark: 'Sempre usar tema escuro',
    },
    display: 'Exibição',
    displayDescription: 'Controle layout e espaçamento',
    inlineToolCalls: 'Chamadas de ferramentas inline',
    inlineToolCallsDescription: 'Exibir chamadas de ferramentas diretamente nas mensagens do chat',
    expandTodoLists: 'Expandir listas de tarefas',
    expandTodoListsDescription: 'Mostrar todas as tarefas em vez de apenas as mudanças',
    showLineNumbersInDiffs: 'Mostrar números de linha nos diffs',
    showLineNumbersInDiffsDescription: 'Exibir números de linha nos diffs de código',
    showLineNumbersInToolViews: 'Mostrar números de linha nas visualizações de ferramentas',
    showLineNumbersInToolViewsDescription:
      'Exibir números de linha nos diffs das visualizações de ferramentas',
    wrapLinesInDiffs: 'Quebrar linhas nos diffs',
    wrapLinesInDiffsDescription:
      'Quebrar linhas longas ao invés de rolagem horizontal nas visualizações de diffs',
    alwaysShowContextSize: 'Sempre mostrar tamanho do contexto',
    alwaysShowContextSizeDescription:
      'Exibir uso do contexto mesmo quando não estiver próximo do limite',
    avatarStyle: 'Estilo do avatar',
    avatarStyleDescription: 'Escolha a aparência do avatar da sessão',
    avatarOptions: {
      pixelated: 'Pixelizado',
      gradient: 'Gradiente',
      brutalist: 'Brutalista',
    },
    showFlavorIcons: 'Mostrar ícones de provedores de IA',
    showFlavorIconsDescription: 'Exibir ícones do provedor de IA nos avatares de sessão',
    compactSessionView: 'Visualização compacta de sessões',
    compactSessionViewDescription: 'Mostrar sessões ativas em um layout mais compacto',
  },

  settingsFeatures: {
    // Features settings screen
    experiments: 'Experimentos',
    experimentsDescription:
      'Ative recursos experimentais que ainda estão em desenvolvimento. Estes recursos podem ser instáveis ou mudar sem aviso.',
    experimentalFeatures: 'Recursos experimentais',
    experimentalFeaturesEnabled: 'Recursos experimentais ativados',
    experimentalFeaturesDisabled: 'Usando apenas recursos estáveis',
    webFeatures: 'Recursos web',
    webFeaturesDescription: 'Recursos disponíveis apenas na versão web do aplicativo.',
    enterToSend: 'Enter para enviar',
    enterToSendEnabled: 'Pressione Enter para enviar (Shift+Enter para nova linha)',
    enterToSendDisabled: 'Enter insere uma nova linha',
    commandPalette: 'Paleta de comandos',
    commandPaletteEnabled: 'Pressione ⌘K para abrir',
    commandPaletteDisabled: 'Acesso rápido a comandos desativado',
    markdownCopyV2: 'Markdown Copy v2',
    markdownCopyV2Subtitle: 'Pressione e segure para abrir modal de cópia',
    hideInactiveSessions: 'Ocultar sessões inativas',
    hideInactiveSessionsSubtitle: 'Mostre apenas os chats ativos na sua lista',
    enhancedSessionWizard: 'Assistente de sessão aprimorado',
    enhancedSessionWizardEnabled: 'Lançador de sessão com perfil ativo',
    enhancedSessionWizardDisabled: 'Usando o lançador de sessão padrão',

},

  errors: {
    networkError: 'Ocorreu um erro de rede',
    serverError: 'Ocorreu um erro do servidor',
    unknownError: 'Ocorreu um erro desconhecido',
    connectionTimeout: 'Tempo limite da conexão esgotado',
    authenticationFailed: 'Falha na autenticação',
    permissionDenied: 'Permissão negada',
    fileNotFound: 'Arquivo não encontrado',
    invalidFormat: 'Formato inválido',
    operationFailed: 'Operação falhou',
    tryAgain: 'Por favor, tente novamente',
    contactSupport: 'Entre em contato com o suporte se o problema persistir',
    sessionNotFound: 'Sessão não encontrada',
    voiceSessionFailed: 'Falha ao iniciar sessão de voz',
    voiceServiceUnavailable: 'Serviço de voz temporariamente indisponível',
    voiceNotConfigured: 'Voice feature is not configured. Please contact support.',
    voiceNotInitialized:
      'Voice service failed to initialize. Please restart the app and try again.',
    voiceMicPermissionWeb:
      'Microphone access is required for voice. Please allow microphone permission in your browser settings.',
    voiceTokenRejected: 'Voice service is not available on this server.',
    oauthInitializationFailed: 'Falha ao inicializar o fluxo OAuth',
    tokenStorageFailed: 'Falha ao armazenar tokens de autenticação',
    oauthStateMismatch: 'Falha na validação de segurança. Por favor, tente novamente',
    tokenExchangeFailed: 'Falha ao trocar código de autorização',
    oauthAuthorizationDenied: 'A autorização foi negada',
    webViewLoadFailed: 'Falha ao carregar a página de autenticação',
    failedToLoadProfile: 'Falha ao carregar o perfil do usuário',
    userNotFound: 'Usuário não encontrado',
    sessionDeleted: 'A sessão foi excluída',
    sessionDeletedDescription: 'Esta sessão foi removida permanentemente',

    // Error functions with context
    fieldError: ({ field, reason }: { field: string; reason: string }) => `${field}: ${reason}`,
    validationError: ({ field, min, max }: { field: string; min: number; max: number }) =>
      `${field} deve estar entre ${min} e ${max}`,
    retryIn: ({ seconds }: { seconds: number }) =>
      `Tentar novamente em ${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`,
    errorWithCode: ({ message, code }: { message: string; code: number | string }) =>
      `${message} (Erro ${code})`,
    disconnectServiceFailed: ({ service }: { service: string }) =>
      `Falha ao desconectar ${service}`,
    connectServiceFailed: ({ service }: { service: string }) =>
      `Falha ao conectar ${service}. Por favor, tente novamente.`,
    failedToLoadFriends: 'Falha ao carregar lista de amigos',
    failedToAcceptRequest: 'Falha ao aceitar solicitação de amizade',
    failedToRejectRequest: 'Falha ao rejeitar solicitação de amizade',
    failedToRemoveFriend: 'Falha ao remover amigo',
    searchFailed: 'A busca falhou. Por favor, tente novamente.',
    failedToSendRequest: 'Falha ao enviar solicitação de amizade',
  },

  newSession: {
    // Used by new-session screen and launch flows
    title: 'Iniciar nova sessão',
    noMachinesFound:
      'Nenhuma máquina encontrada. Inicie uma sessão Free no seu computador primeiro.',
    allMachinesOffline: 'Todas as máquinas estão offline',
    machineDetails: 'Ver detalhes da máquina →',
    directoryDoesNotExist: 'Diretório não encontrado',
    createDirectoryConfirm: ({ directory }: { directory: string }) =>
      `O diretório ${directory} não existe. Deseja criá-lo?`,
    sessionStarted: 'Sessão iniciada',
    sessionStartedMessage: 'A sessão foi iniciada com sucesso.',
    sessionSpawningFailed: 'Falha ao criar sessão - nenhum ID de sessão foi retornado.',
    failedToStart:
      'Falha ao iniciar sessão. Certifique-se de que o daemon está rodando na máquina de destino.',
    sessionTimeout:
      'Tempo limite de inicialização da sessão esgotado. A máquina pode estar lenta ou o daemon pode não estar respondendo.',
    notConnectedToServer: 'Não conectado ao servidor. Verifique sua conexão com a internet.',
    startingSession: 'Iniciando sessão...',
    startNewSessionInFolder: 'Nova sessão aqui',
    noMachineSelected: 'Por favor, selecione uma máquina para iniciar a sessão',
    noPathSelected: 'Por favor, selecione um diretório para iniciar a sessão',
    sessionType: {
      title: 'Tipo de sessão',
      simple: 'Simples',
      worktree: 'Worktree',
      comingSoon: 'Em breve',
    },
    worktree: {
      creating: ({ name }: { name: string }) => `Criando worktree '${name}'...`,
      notGitRepo: 'Worktrees requerem um repositório git',
      failed: ({ error }: { error: string }) => `Falha ao criar worktree: ${error}`,
      success: 'Worktree criado com sucesso',
    },
    inputPlaceholder: 'No que você gostaria de trabalhar?',
    capabilityDiscoveryNotice:
      'Envie sua primeira mensagem para carregar modos, modelos e comandos.',
  },

  agentPicker: {
    headerTitle: 'Selecionar agente',
    heroEyebrow: 'Seletor de implementação',
    heroTitle: 'Escolha o runtime com o qual deseja começar.',
    heroDescription:
      'Cada opção abaixo é descoberta a partir das implementações registradas na máquina selecionada. As entradas clássicas e ACP são mantidas separadas propositalmente.',
    experimentalSection: 'Experimental',
    experimentalCaption: 'Agentes opcionais por trás da configuração de experimentos.',
    noAgentsTitle: 'Nenhum agente disponível',
    noAgentsDescription: 'Esta máquina não reportou nenhuma implementação executável.',
    tagAcp: 'ACP',
    tagClassic: 'Clássico',
    tagAnthropic: 'Anthropic',
    tagOpenAI: 'OpenAI',
    tagGoogle: 'Google',
    tagTerminal: 'Terminal',
    tagExperimental: 'Experimental',
  },

  machinePicker: {
    headerTitle: 'Selecionar máquina',
    noMachinesAvailable: 'Nenhuma máquina disponível',
    online: 'online',
    offline: 'offline',
    searchPlaceholder: 'Digite para filtrar máquinas...',
    recentSection: 'Máquinas recentes',
    favoritesSection: 'Máquinas favoritas',
    allSection: 'Todos os dispositivos',
  },

  pathPicker: {
    headerTitle: 'Selecionar caminho',
    noMachineSelected: 'Nenhuma máquina selecionada',
    enterPath: 'Inserir caminho',
    enterPathPlaceholder: 'Inserir caminho (ex. /home/user/projects)',
    recentPaths: 'Caminhos recentes',
    suggestedPaths: 'Caminhos sugeridos',
    browse: 'Explorar',
    browseError: 'Não foi possível carregar o diretório',
    emptyDirectory: 'Sem subdiretórios',
  },

  sessionHistory: {
    // Used by session history screen
    title: 'Histórico de sessões',
    empty: 'Nenhuma sessão encontrada',
    today: 'Hoje',
    yesterday: 'Ontem',
    daysAgo: ({ count }: { count: number }) => `há ${count} ${count === 1 ? 'dia' : 'dias'}`,
    viewAll: 'Ver todas as sessões',
  },

  session: {
    inputPlaceholder: 'Digite uma mensagem ...',
    sendFailed: 'Falha no envio. Toque para tentar novamente.',
    sendBlockedServerDisconnected: 'Servidor desconectado, não é possível enviar mensagem',
    sendBlockedDaemonOffline: 'Sessão offline, não é possível enviar mensagem',
    addImage: 'Adicionar imagem',
    pasteFromClipboard: 'Colar da área de transferência',
    chooseFromLibrary: 'Escolher da biblioteca',
  },

  commandPalette: {
    placeholder: 'Digite um comando ou pesquise...',
  },

  server: {
    // Used by Server Configuration screen (app/(app)/server.tsx)
    serverConfiguration: 'Configuração do servidor',
    enterServerUrl: 'Por favor, insira uma URL do servidor',
    notValidFreeServer: 'Não é um servidor Free válido',
    changeServer: 'Alterar servidor',
    continueWithServer: 'Continuar com este servidor?',
    resetToDefault: 'Redefinir para padrão',
    resetServerDefault: 'Redefinir servidor para padrão?',
    validating: 'Validando...',
    validatingServer: 'Validando servidor...',
    serverReturnedError: 'O servidor retornou um erro',
    failedToConnectToServer: 'Falha ao conectar com o servidor',
    currentlyUsingCustomServer: 'Atualmente usando servidor personalizado',
    customServerUrlLabel: 'URL do servidor personalizado',
    advancedFeatureFooter:
      'Este é um recurso avançado. Altere o servidor apenas se souber o que está fazendo. Você precisará sair e entrar novamente após alterar servidores.',
  },

  sessionInfo: {
    // Used by Session Info screen (app/(app)/session/[id]/info.tsx)
    killSession: 'Encerrar sessão',
    killSessionConfirm: 'Tem certeza de que deseja encerrar esta sessão?',
    archiveSession: 'Arquivar sessão',
    archiveSessionConfirm: 'Tem certeza de que deseja arquivar esta sessão?',
    freeSessionIdCopied: 'ID da sessão Free copiado para a área de transferência',
    failedToCopySessionId: 'Falha ao copiar ID da sessão Free',
    freeSessionId: 'ID da sessão Free',
    agentSessionId: 'ID da sessão Claude Code',
    agentSessionIdCopied: 'ID da sessão Claude Code copiado para a área de transferência',
    aiProvider: 'Provedor de IA',
    failedToCopyAgentSessionId: 'Falha ao copiar ID da sessão Claude Code',
    metadataCopied: 'Metadados copiados para a área de transferência',
    failedToCopyMetadata: 'Falha ao copiar metadados',
    failedToKillSession: 'Falha ao encerrar sessão',
    failedToArchiveSession: 'Falha ao arquivar sessão',
    connectionStatus: 'Status da conexão',
    created: 'Criado',
    lastUpdated: 'Última atualização',
    sequence: 'Sequência',
    quickActions: 'Ações rápidas',
    viewMachine: 'Ver máquina',
    viewMachineSubtitle: 'Ver detalhes da máquina e sessões',
    killSessionSubtitle: 'Encerrar imediatamente a sessão',
    archiveSessionSubtitle: 'Arquivar esta sessão e pará-la',
    recoveryFailedArchiveSubtitle: 'Esta sessão não conseguiu recuperar após uma falha',
    metadata: 'Metadados',
    host: 'Host',
    path: 'Caminho',
    operatingSystem: 'Sistema operacional',
    processId: 'ID do processo',
    freeHome: 'Diretório Free',
    copyMetadata: 'Copiar metadados',
    agentState: 'Estado do agente',
    controlledByUser: 'Controlado pelo usuário',
    pendingRequests: 'Solicitações pendentes',
    activity: 'Atividade',
    thinking: 'Pensando',
    thinkingSince: 'Pensando desde',
    cliVersion: 'Versão do CLI',
    cliVersionOutdated: 'Atualização do CLI necessária',
    cliVersionOutdatedMessage: ({
      currentVersion,
      requiredVersion,
    }: {
      currentVersion: string;
      requiredVersion: string;
    }) => `Versão ${currentVersion} instalada. Atualize para ${requiredVersion} ou posterior`,
    updateCliInstructions:
      'Por favor execute npm install -g @saaskit-dev/free',
    restartAgent: 'Reinício forçado do agente',
    restartAgentConfirm: 'Isso encerrará o processo do agente atual e iniciará um novo. A sessão e o histórico de conversas serão preservados.',
    restartAgentSubtitle: 'Encerrar e reiniciar o processo do agente',
    restartAgentSuccess: 'O processo do agente está reiniciando.',
    failedToRestartAgent: 'Falha ao reiniciar o agente',
    deleteSession: 'Excluir sessão',
    deleteSessionSubtitle: 'Remover permanentemente esta sessão',
    deleteSessionConfirm: 'Excluir sessão permanentemente?',
    deleteSessionWarning:
      'Esta ação não pode ser desfeita. Todas as mensagens e dados associados a esta sessão serão excluídos permanentemente.',
    failedToDeleteSession: 'Falha ao excluir sessão',
    sessionDeleted: 'Sessão excluída com sucesso',
    clearCache: 'Limpar cache',
    clearCacheSubtitle: 'Limpar dados de cache local para esta sessão',
    clearCacheConfirm: 'Limpar todos os dados de cache para esta sessão? As mensagens serão obtidas novamente do servidor.',
    clearCacheSuccess: 'Cache limpo com sucesso',
    clearCacheFailed: 'Falha ao limpar o cache',
  },

  components: {
    emptyMainScreen: {
      // Used by EmptyMainScreen component
      readyToCode: 'Pronto para programar?',
      installCli: 'Instale o Free CLI',
      runIt: 'Execute',
      scanQrCode: 'Escaneie o código QR',
      openCamera: 'Abrir câmera',
    },
  },

  agentInput: {
    permissionMode: {
      title: 'MODO DE PERMISSÃO',
      readOnly: 'Somente leitura',
      acceptEdits: 'Aceitar edições',
      yolo: 'YOLO',
      badgeReadOnly: 'Somente leitura',
      badgeAcceptEdits: 'Aceitar edições',
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
      configureInCli: 'Configurar modelos nas configurações do CLI',
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
      fileLabel: 'ARQUIVO',
      folderLabel: 'PASTA',
    },
    noMachinesAvailable: 'Sem máquinas',
    speechInput: {
      recording: 'Ouvindo...',
      permissionTitle: 'Acesso ao microfone necessário',
      permissionMessage: 'Permita o acesso ao microfone e ao reconhecimento de voz nas definições do sistema.',
      permissionCancel: 'Cancelar',
      permissionOpenSettings: 'Abrir definições',
      errorTitle: 'Falha no reconhecimento de voz',
      errorMessage: ({ error }: { error: string }) => `Não foi possível iniciar o reconhecimento de voz (${error}).`,
      languageUnavailableTitle: 'Pacote de idioma não instalado',
      languageUnavailableMessage: 'O pacote de reconhecimento de voz para o idioma selecionado não foi baixado. Abra as configurações para instalá-lo ou mude para inglês.',
      languageUnavailableCancel: 'Cancelar',
      languageUnavailableOpenSettings: 'Abrir configurações',
      languageUnavailableUseEnglish: 'Usar inglês',
    },
  },

  machineLauncher: {
    showLess: 'Mostrar menos',
    showAll: ({ count }: { count: number }) => `Mostrar todos (${count} caminhos)`,
    enterCustomPath: 'Inserir caminho personalizado',
    offlineUnableToSpawn: 'Não é possível criar nova sessão, você está offline',
  },

  sidebar: {
    sessionsTitle: 'Free',
  },

  toolView: {
    input: 'Entrada',
    output: 'Saída',
  },

  tools: {
    fullView: {
      description: 'Descrição',
      inputParams: 'Parâmetros de entrada',
      output: 'Saída',
      error: 'Erro',
      completed: 'Ferramenta concluída com sucesso',
      noOutput: 'Nenhuma saída foi produzida',
      running: 'Ferramenta está executando...',
      rawJsonDevMode: 'JSON bruto (modo desenvolvedor)',
    },
    taskView: {
      initializing: 'Inicializando agente...',
      moreTools: ({ count }: { count: number }) =>
        `+${count} mais ${plural({ count, singular: 'ferramenta', plural: 'ferramentas' })}`,
    },
    multiEdit: {
      editNumber: ({ index, total }: { index: number; total: number }) =>
        `Edição ${index} de ${total}`,
      replaceAll: 'Substituir tudo',
    },
    names: {
      task: 'Tarefa',
      terminal: 'Terminal',
      searchFiles: 'Buscar arquivos',
      search: 'Buscar',
      searchContent: 'Buscar conteúdo',
      listFiles: 'Listar arquivos',
      planProposal: 'Proposta de plano',
      readFile: 'Ler arquivo',
      editFile: 'Editar arquivo',
      writeFile: 'Escrever arquivo',
      fetchUrl: 'Buscar URL',
      readNotebook: 'Ler notebook',
      editNotebook: 'Editar notebook',
      todoList: 'Lista de tarefas',
      webSearch: 'Busca web',
      toolSearch: 'Buscar ferramentas',
      reasoning: 'Raciocínio',
      applyChanges: 'Atualizar arquivo',
      viewDiff: 'Alterações do arquivo atual',
      question: 'Pergunta',
    },
    desc: {
      terminalCmd: ({ cmd }: { cmd: string }) => `Terminal(cmd: ${cmd})`,
      searchPattern: ({ pattern }: { pattern: string }) => `Buscar(padrão: ${pattern})`,
      searchPath: ({ basename }: { basename: string }) => `Buscar(caminho: ${basename})`,
      fetchUrlHost: ({ host }: { host: string }) => `Buscar URL(url: ${host})`,
      editNotebookMode: ({ path, mode }: { path: string; mode: string }) =>
        `Editar notebook(arquivo: ${path}, modo: ${mode})`,
      todoListCount: ({ count }: { count: number }) => `Lista de tarefas(quantidade: ${count})`,
      webSearchQuery: ({ query }: { query: string }) => `Busca web(consulta: ${query})`,
      grepPattern: ({ pattern }: { pattern: string }) => `grep(padrão: ${pattern})`,
      multiEditEdits: ({ path, count }: { path: string; count: number }) =>
        `${path} (${count} edições)`,
      readingFile: ({ file }: { file: string }) => `Lendo ${file}`,
      writingFile: ({ file }: { file: string }) => `Escrevendo ${file}`,
      modifyingFile: ({ file }: { file: string }) => `Modificando ${file}`,
      modifyingFiles: ({ count }: { count: number }) => `Modificando ${count} arquivos`,
      modifyingMultipleFiles: ({ file, count }: { file: string; count: number }) =>
        `${file} e ${count} mais`,
      showingDiff: 'Mostrando alterações',
    },
    askUserQuestion: {
      submit: 'Enviar resposta',
      multipleQuestions: ({ count }: { count: number }) =>
        `${count} ${plural({ count, singular: 'pergunta', plural: 'perguntas' })}`,
      other: 'Outro',
      otherDescription: 'Digite sua própria resposta',
      otherPlaceholder: 'Digite sua resposta...',
    },
  },

  files: {
    searchPlaceholder: 'Buscar arquivos...',
    detachedHead: 'HEAD desanexado',
    summary: ({ staged, unstaged }: { staged: number; unstaged: number }) =>
      `${staged} preparados • ${unstaged} não preparados`,
    notRepo: 'Não é um repositório git',
    notUnderGit: 'Este diretório não está sob controle de versão git',
    searching: 'Buscando arquivos...',
    noFilesFound: 'Nenhum arquivo encontrado',
    noFilesInProject: 'Nenhum arquivo no projeto',
    tryDifferentTerm: 'Tente um termo de busca diferente',
    searchResults: ({ count }: { count: number }) => `Resultados da busca (${count})`,
    projectRoot: 'Raiz do projeto',
    stagedChanges: ({ count }: { count: number }) => `Alterações preparadas (${count})`,
    unstagedChanges: ({ count }: { count: number }) => `Alterações não preparadas (${count})`,
    // File viewer strings
    loadingFile: ({ fileName }: { fileName: string }) => `Carregando ${fileName}...`,
    binaryFile: 'Arquivo binário',
    cannotDisplayBinary: 'Não é possível exibir o conteúdo do arquivo binário',
    diff: 'Diff',
    file: 'Arquivo',
    fileEmpty: 'Arquivo está vazio',
    noChanges: 'Nenhuma alteração para exibir',
  },

  settingsAccount: {
    // Account settings screen
    accountInformation: 'Informações da conta',
    status: 'Status',
    statusActive: 'Ativo',
    statusNotAuthenticated: 'Não autenticado',
    anonymousId: 'ID anônimo',
    publicId: 'ID público',
    notAvailable: 'Não disponível',
    linkNewDevice: 'Vincular novo dispositivo',
    linkNewDeviceSubtitle: 'Escanear código QR para vincular dispositivo',
    profile: 'Perfil',
    name: 'Nome',
    github: 'GitHub',
    tapToDisconnect: 'Toque para desconectar',
    server: 'Servidor',
    backup: 'Backup',
    backupDescription:
      'Sua chave secreta é a única forma de recuperar sua conta. Salve-a em um local seguro como um gerenciador de senhas.',
    secretKey: 'Chave secreta',
    tapToReveal: 'Toque para revelar',
    tapToHide: 'Toque para ocultar',
    secretKeyLabel: 'CHAVE SECRETA (TOQUE PARA COPIAR)',
    secretKeyCopied:
      'Chave secreta copiada para a área de transferência. Guarde-a em um local seguro!',
    secretKeyCopyFailed: 'Falha ao copiar chave secreta',
    privacy: 'Privacidade',
    privacyDescription:
      'Ajude a melhorar o aplicativo compartilhando dados de uso anônimos. Nenhuma informação pessoal é coletada.',
    analytics: 'Análises',
    analyticsDisabled: 'Nenhum dado é compartilhado',
    analyticsEnabled: 'Dados de uso anônimos são compartilhados',
    dangerZone: 'Zona perigosa',
    logout: 'Sair',
    logoutSubtitle: 'Sair e limpar dados locais',
    logoutConfirm:
      'Tem certeza de que quer sair? Certifique-se de ter feito backup da sua chave secreta!',
  },

  settingsLanguage: {
    // Language settings screen
    title: 'Idioma',
    description:
      'Escolher o idioma preferido para a interface do aplicativo. Isso vai ser sincronizado em todos os seus dispositivos.',
    currentLanguage: 'Idioma atual',
    automatic: 'Automático',
    automaticSubtitle: 'Detectar das configurações do dispositivo',
    needsRestart: 'Idioma alterado',
    needsRestartMessage:
      'O aplicativo precisa ser reiniciado para aplicar a nova configuração de idioma.',
    restartNow: 'Reiniciar agora',
  },

  connectButton: {
    authenticate: 'Autenticar terminal',
    authenticateWithUrlPaste: 'Autenticar terminal com colagem de URL',
    pasteAuthUrl: 'Cole a URL de autenticação do seu terminal',
  },

  updateBanner: {
    updateAvailable: 'Atualização disponível',
    pressToApply: 'Pressione para aplicar a atualização',
    whatsNew: 'Novidades',
    seeLatest: 'Veja as atualizações e melhorias mais recentes',
    nativeUpdateAvailable: 'Atualização do aplicativo disponível',
    tapToUpdateAppStore: 'Toque para atualizar na App Store',
    tapToUpdatePlayStore: 'Toque para atualizar na Play Store',
  },

  changelog: {
    // Used by the changelog screen
    version: ({ version }: { version: number }) => `Versão ${version}`,
    noEntriesAvailable: 'Nenhuma entrada de changelog disponível.',
  },

  terminal: {
    // Used by terminal connection screens
    webBrowserRequired: 'Navegador web necessário',
    webBrowserRequiredDescription:
      'Links de conexão de terminal só podem ser abertos em um navegador web por questões de segurança. Use o leitor de código QR ou abra este link num computador.',
    processingConnection: 'Processando conexão...',
    invalidConnectionLink: 'Link de conexão inválido',
    invalidConnectionLinkDescription:
      'O link de conexão está ausente ou inválido. Verifique a URL e tente novamente.',
    connectTerminal: 'Conectar terminal',
    terminalRequestDescription:
      'Um terminal está solicitando conexão à sua conta Free Coder. Isso permitirá que o terminal envie e receba mensagens com segurança.',
    connectionDetails: 'Detalhes da conexão',
    publicKey: 'Chave pública',
    encryption: 'Criptografia',
    endToEndEncrypted: 'Criptografia ponta a ponta',
    acceptConnection: 'Aceitar conexão',
    createAccountAndAccept: 'Criar conta e aceitar',
    creatingAccount: 'Criando conta...',
    connecting: 'Conectando...',
    reject: 'Rejeitar',
    security: 'Segurança',
    securityFooter:
      'Este link de conexão foi processado com segurança no seu navegador e nunca foi enviado para nenhum servidor. Seus dados privados permanecerão seguros e apenas você pode descriptografar as mensagens.',
    securityFooterDevice:
      'Esta conexão foi processada com segurança no seu dispositivo e nunca foi enviada para nenhum servidor. Seus dados privados permanecerão seguros e apenas você pode descriptografar as mensagens.',
    clientSideProcessing: 'Processamento do lado cliente',
    linkProcessedLocally: 'Link processado localmente no navegador',
    linkProcessedOnDevice: 'Link processado localmente no dispositivo',
  },

  modals: {
    // Used across connect flows and settings
    authenticateTerminal: 'Autenticar terminal',
    pasteUrlFromTerminal: 'Cole a URL de autenticação do seu terminal',
    deviceLinkedSuccessfully: 'Dispositivo vinculado com sucesso',
    terminalConnectedSuccessfully: 'Terminal conectado com sucesso',
    invalidAuthUrl: 'URL de autenticação inválida',
    developerMode: 'Modo desenvolvedor',
    developerModeEnabled: 'Modo desenvolvedor ativado',
    developerModeDisabled: 'Modo desenvolvedor desativado',
    disconnectGithub: 'Desconectar GitHub',
    disconnectGithubConfirm: 'Tem certeza de que deseja desconectar sua conta GitHub?',
    disconnectService: ({ service }: { service: string }) => `Desconectar ${service}`,
    disconnectServiceConfirm: ({ service }: { service: string }) =>
      `Tem certeza de que deseja desconectar ${service} da sua conta?`,
    disconnect: 'Desconectar',
    failedToConnectTerminal: 'Falha ao conectar terminal',
    cameraPermissionsRequiredToConnectTerminal:
      'Permissões de câmera são necessárias para conectar terminal',
    failedToLinkDevice: 'Falha ao vincular dispositivo',
    cameraPermissionsRequiredToScanQr:
      'Permissões de câmera são necessárias para escanear códigos QR',
  },

  navigation: {
    // Navigation titles and screen headers
    connectTerminal: 'Conectar terminal',
    linkNewDevice: 'Vincular novo dispositivo',
    restoreWithSecretKey: 'Restaurar com chave secreta',
    whatsNew: 'Novidades',
    friends: 'Amigos',
    importExistingAgentSessions: 'Importar sessões de agente existentes',
    connectTo: ({ name }: { name: string }) => `Conectar a ${name}`,
    developerTools: 'Ferramentas de desenvolvedor',
    listComponentsDemo: 'Demo de componentes de lista',
    typography: 'Tipografia',
    colors: 'Cores',
    toolViewsDemo: 'Demo de visualizações de ferramentas',
    shimmerViewDemo: 'Demo de visualização shimmer',
    multiTextInput: 'Entrada de texto multilinha',
  },

  welcome: {
    // Main welcome screen for unauthenticated users
    title: 'Cliente móvel Codex e Claude Code',
    subtitle: 'Criptografado ponta a ponta e sua conta é armazenada apenas no seu dispositivo.',
    createAccount: 'Criar conta',
    linkOrRestoreAccount: 'Vincular ou restaurar conta',
    loginWithMobileApp: 'Fazer login com aplicativo móvel',
  },

  review: {
    // Used by utils/requestReview.ts
    enjoyingApp: 'Curtindo o aplicativo?',
    feedbackPrompt: 'Adoraríamos ouvir seu feedback!',
    yesILoveIt: 'Sim, eu amo!',
    notReally: 'Não muito',
  },

  items: {
    // Used by Item component for copy toast
    copiedToClipboard: ({ label }: { label: string }) =>
      `${label} copiado para a área de transferência`,
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
    offlineUnableToSpawn: 'Inicializador desativado enquanto a máquina está offline',
    offlineHelp:
      '• Verifique se seu computador está online\n• Execute `free daemon status` para diagnosticar\n• Você está usando a versão mais recente do CLI? Atualize com `npm install -g @saaskit-dev/free`',
    launchNewSessionInDirectory: 'Iniciar nova sessão no diretório',
    enterCustomPath: 'Inserir caminho personalizado',
    previousSessions: 'Sessões anteriores (até 5 mais recentes)',
    machineNotFound: 'Máquina não encontrada',
    stopDaemonConfirmTitle: 'Parar o daemon?',
    stopDaemonConfirmMessage: 'Você não poderá criar novas sessões nesta máquina até reiniciar o daemon no seu computador. Suas sessões atuais permanecerão ativas.',
    daemonStopped: 'Daemon parado',
    failedToStopDaemon: 'Falha ao parar o daemon. Pode não estar em execução.',
    renameMachine: 'Renomear máquina',
    renameMachineMessage: 'Dê um nome personalizado a esta máquina. Deixe vazio para usar o hostname padrão.',
    enterMachineName: 'Inserir nome da máquina',
    machineRenamed: 'Máquina renomeada com sucesso',
    createDirectoryTitle: 'Criar diretório?',
    createDirectoryMessage: ({ directory }: { directory: string }) => `O diretório '${directory}' não existe. Deseja criá-lo?`,
    failedToStartSession: 'Falha ao iniciar a sessão. Certifique-se de que o daemon esteja em execução na máquina de destino.',
    daemon: 'Daemon',
    status: 'Status',
    stopDaemon: 'Parar daemon',
    lastKnownPid: 'Último PID conhecido',
    lastKnownHttpPort: 'Última porta HTTP conhecida',
    startedAt: 'Iniciado em',
    cliVersion: 'Versão do CLI',
    daemonStateVersion: 'Versão do estado do daemon',
    activeSessions: ({ count }: { count: number }) => `Sessões ativas (${count})`,
    machineGroup: 'Máquina',
    host: 'Host',
    machineId: 'ID da máquina',
    username: 'Nome de usuário',
    homeDirectory: 'Diretório home',
    platform: 'Plataforma',
    architecture: 'Arquitetura',
    lastSeen: 'Visto pela última vez',
    never: 'Nunca',
    metadataVersion: 'Versão dos metadados',
    untitledSession: 'Sessão sem título',
    back: 'Voltar',
  },

  message: {
    switchedToMode: ({ mode }: { mode: string }) => `Mudou para o modo ${mode}`,
    unknownEvent: 'Evento desconhecido',
    usageLimitUntil: ({ time }: { time: string }) => `Limite de uso atingido até ${time}`,
    unknownTime: 'horário desconhecido',
    permissionRequest: ({ toolName }: { toolName: string }) => 'Permission request for ' + toolName,
    permissionMode: ({ mode }: { mode: string }) => 'Permission mode: ' + mode,
  },

  chatList: {
    pullToRefresh: 'Puxe para atualizar',
    releaseToRefresh: 'Solte para atualizar',
    refreshing: 'Atualizando...',
    pullToLoadEarlier: 'Puxe para carregar anteriores',
    releaseToLoadEarlier: 'Solte para carregar anteriores',
    loadingEarlier: 'Carregando...',
    scrollToBottom: 'Ir para o final',
    newMessages: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? 'nova mensagem' : 'novas mensagens'}`,
    today: 'Hoje',
    yesterday: 'Ontem',
  },

  codex: {
    // Codex permission dialog buttons
    permissions: {
      yesForSession: 'Sim, e não perguntar para esta sessão',
      stopAndExplain: 'Parar, e explicar o que fazer',
    },
  },

  claude: {
    // Claude permission dialog buttons
    permissions: {
      yesAllowAllEdits: 'Sim, permitir todas as edições durante esta sessão',
      yesForTool: 'Sim, não perguntar novamente para esta ferramenta',
      noTellClaude: 'Não, fornecer feedback',
    },
  },

  textSelection: {
    // Text selection screen
    selectText: 'Selecionar intervalo de texto',
    title: 'Selecionar texto',
    noTextProvided: 'Nenhum texto fornecido',
    textNotFound: 'Texto não encontrado ou expirado',
    textCopied: 'Texto copiado para a área de transferência',
    failedToCopy: 'Falha ao copiar o texto para a área de transferência',
    noTextToCopy: 'Nenhum texto disponível para copiar',
  },

  markdown: {
    // Markdown copy functionality
    codeCopied: 'Código copiado',
    copyFailed: 'Falha ao copiar',
    mermaidRenderFailed: 'Falha ao renderizar diagrama mermaid',
  },

  artifacts: {
    title: 'Artefatos',
    countSingular: '1 artefato',
    countPlural: ({ count }: { count: number }) => `${count} artefatos`,
    empty: 'Ainda não há artefatos',
    emptyDescription: 'Crie seu primeiro artefato para salvar e organizar conteúdo',
    new: 'Novo artefato',
    edit: 'Editar artefato',
    delete: 'Excluir',
    updateError: 'Falha ao atualizar artefato. Por favor, tente novamente.',
    notFound: 'Artefato não encontrado',
    discardChanges: 'Descartar alterações?',
    discardChangesDescription:
      'Você tem alterações não salvas. Tem certeza de que deseja descartá-las?',
    deleteConfirm: 'Excluir artefato?',
    deleteConfirmDescription: 'Este artefato será excluído permanentemente.',
    titlePlaceholder: 'Título do artefato',
    bodyPlaceholder: 'Digite o conteúdo aqui...',
    save: 'Salvar',
    saving: 'Salvando...',
    loading: 'Carregando...',
    error: 'Falha ao carregar artefatos',
    titleLabel: 'TÍTULO',
    bodyLabel: 'CONTEÚDO',
    emptyFieldsError: 'Por favor, insira um título ou conteúdo',
    createError: 'Falha ao criar artefato. Por favor, tente novamente.',
  },

  friends: {
    // Friends feature
    title: 'Amigos',
    manageFriends: 'Gerencie seus amigos e conexões',
    searchTitle: 'Buscar amigos',
    pendingRequests: 'Solicitações de amizade',
    myFriends: 'Meus amigos',
    noFriendsYet: 'Você ainda não tem amigos',
    findFriends: 'Buscar amigos',
    remove: 'Remover',
    pendingRequest: 'Pendente',
    sentOn: ({ date }: { date: string }) => `Enviado em ${date}`,
    accept: 'Aceitar',
    reject: 'Rejeitar',
    addFriend: 'Adicionar amigo',
    alreadyFriends: 'Já são amigos',
    requestPending: 'Solicitação pendente',
    searchInstructions: 'Digite um nome de usuário para buscar amigos',
    searchPlaceholder: 'Digite o nome de usuário...',
    searching: 'Buscando...',
    userNotFound: 'Usuário não encontrado',
    noUserFound: 'Nenhum usuário encontrado com esse nome',
    checkUsername: 'Por favor, verifique o nome de usuário e tente novamente',
    howToFind: 'Como encontrar amigos',
    findInstructions:
      'Procure amigos pelo nome de usuário. Tanto você quanto seu amigo precisam ter o GitHub conectado para enviar solicitações de amizade.',
    requestSent: 'Solicitação de amizade enviada!',
    requestAccepted: 'Solicitação de amizade aceita!',
    requestRejected: 'Solicitação de amizade rejeitada',
    friendRemoved: 'Amigo removido',
    confirmRemove: 'Remover amigo',
    confirmRemoveMessage: 'Tem certeza de que deseja remover este amigo?',
    cannotAddYourself: 'Você não pode enviar uma solicitação de amizade para si mesmo',
    bothMustHaveGithub: 'Ambos os usuários devem ter o GitHub conectado para serem amigos',
    status: {
      none: 'Não conectado',
      requested: 'Solicitação enviada',
      pending: 'Solicitação pendente',
      friend: 'Amigos',
      rejected: 'Rejeitada',
    },
    acceptRequest: 'Aceitar solicitação',
    removeFriend: 'Remover dos amigos',
    removeFriendConfirm: ({ name }: { name: string }) =>
      `Tem certeza de que deseja remover ${name} dos seus amigos?`,
    requestSentDescription: ({ name }: { name: string }) =>
      `Sua solicitação de amizade foi enviada para ${name}`,
    requestFriendship: 'Solicitar amizade',
    cancelRequest: 'Cancelar solicitação de amizade',
    cancelRequestConfirm: ({ name }: { name: string }) =>
      `Cancelar sua solicitação de amizade para ${name}?`,
    denyRequest: 'Recusar solicitação',
    nowFriendsWith: ({ name }: { name: string }) => `Agora você é amigo de ${name}`,
  },

  usage: {
    // Usage panel strings
    today: 'Hoje',
    last7Days: 'Últimos 7 dias',
    last30Days: 'Últimos 30 dias',
    totalTokens: 'Tokens totais',
    totalCost: 'Custo total',
    tokens: 'Tokens',
    cost: 'Custo',
    usageOverTime: 'Uso ao longo do tempo',
    byModel: 'Por modelo',
    noData: 'Nenhum dado de uso disponível',
  },

  dev: {
    appInformation: 'Informações do app',
    version: 'Versão',
    buildNumber: 'Número de compilação',
    runtimeVersion: 'Versão do runtime',
    packageSource: 'Fonte do pacote',
    buildTime: 'Data de compilação',
    sdkVersion: 'Versão do SDK',
    platform: 'Plataforma',
    anonymousId: 'ID anônimo',
    notAvailable: 'Não disponível',
    debugOptions: 'Opções de depuração',
    showDebugIds: 'Mostrar IDs de depuração',
    showDebugIdsSubtitle: 'Mostrar IDs de sessão, IDs de agente e JSON bruto nas informações da sessão',
    componentDemos: 'Demos de componentes',
    deviceInfo: 'Informações do dispositivo',
    deviceInfoSubtitle: 'Margens de área segura e parâmetros do dispositivo',
    listComponents: 'Componentes de lista',
    listComponentsSubtitle: 'Demo de Item, ItemGroup e ItemList',
    typography: 'Tipografia',
    typographySubtitle: 'Todos os estilos tipográficos',
    colors: 'Cores',
    colorsSubtitle: 'Paleta de cores e temas',
    messageDemos: 'Demos de mensagens',
    messageDemosSubtitle: 'Vários tipos de mensagens e componentes',
    invertedListTest: 'Teste de lista invertida',
    invertedListTestSubtitle: 'Testar FlatList invertida com teclado',
    toolViews: 'Visualizações de ferramentas',
    toolViewsSubtitle: 'Componentes de visualização de chamadas de ferramentas',
    shimmerView: 'Visualização shimmer',
    shimmerViewSubtitle: 'Efeitos de carregamento shimmer com máscaras',
    multiTextInput: 'Entrada de texto multilinha',
    multiTextInputSubtitle: 'Entrada de texto multilinha com crescimento automático',
    inputStyles: 'Estilos de entrada',
    inputStylesSubtitle: '10+ variantes de estilos de campos de entrada',
    modalSystem: 'Sistema de modais',
    modalSystemSubtitle: 'Alertas, confirmações e modais personalizados',
    unitTests: 'Testes unitários',
    unitTestsSubtitle: 'Executar testes no ambiente do app',
    unistylesDemo: 'Demo de Unistyles',
    unistylesDemoSubtitle: 'Recursos e capacidades do React Native Unistyles',
    qrCodeTest: 'Teste de código QR',
    qrCodeTestSubtitle: 'Testar geração de códigos QR com diferentes parâmetros',
    testFeatures: 'Recursos de teste',
    testFeaturesFooter: 'Estas ações podem afetar a estabilidade do app',
    claudeOAuthTest: 'Teste de OAuth do Claude',
    claudeOAuthTestSubtitle: 'Testar o fluxo de autenticação do Claude',
    testCrash: 'Teste de travamento',
    testCrashSubtitle: 'Provocar um travamento de teste',
    testCrashConfirmTitle: 'Teste de travamento',
    testCrashConfirmMessage: 'Isso travará o app. Continuar?',
    crash: 'Travar',
    clearCache: 'Limpar cache',
    clearCacheSubtitle: 'Remover todos os dados em cache',
    clearCacheConfirmTitle: 'Limpar cache',
    clearCacheConfirmMessage: 'Tem certeza de que deseja limpar todos os dados em cache? As mensagens serão buscadas novamente do servidor.',
    clear: 'Limpar',
    cacheCleared: 'Cache limpo',
    failedToClearCache: ({ error }: { error: string }) => `Falha ao limpar cache: ${error}`,
    resetChangelog: 'Redefinir registro de alterações',
    resetChangelogSubtitle: 'Mostrar o banner "Novidades" novamente',
    changelogReset: 'Registro de alterações redefinido. Reinicie o app para ver o banner.',
    resetAppState: 'Redefinir estado do app',
    resetAppStateSubtitle: 'Limpar todos os dados e preferências do usuário',
    resetApp: 'Redefinir app',
    resetAppConfirmMessage: 'Isso excluirá todos os dados. Tem certeza?',
    system: 'Sistema',
    purchases: 'Compras',
    purchasesSubtitle: 'Ver assinaturas e permissões',
    expoConstants: 'Constantes do Expo',
    expoConstantsSubtitle: 'Ver expoConfig, manifests e constantes do sistema',
    network: 'Rede',
    apiEndpoint: 'Endpoint da API',
    socketIoStatus: 'Status do Socket.IO',
    editApiEndpoint: 'Editar endpoint da API',
    enterServerUrl: 'Insira a URL do servidor:',
    serverUrlUpdated: 'URL do servidor atualizada. Reinicie o app para que as alterações tenham efeito.',
    invalidUrl: 'URL inválida',
    invalidUrlDefault: 'Por favor insira uma URL válida',
    justNow: 'Agora mesmo',
    secondsAgo: ({ seconds }: { seconds: number }) => `${seconds}s atrás`,
    minutesAgo: ({ minutes }: { minutes: number }) => `${minutes}m atrás`,
    hoursAgo: ({ hours }: { hours: number }) => `${hours}h atrás`,
    daysAgo: ({ days }: { days: number }) => `${days}d atrás`,
    connectedAgo: ({ time }: { time: string }) => `Conectado ${time}`,
    lastConnectedAgo: ({ time }: { time: string }) => `Última conexão ${time}`,
    connectingToServer: 'Conectando ao servidor...',
    noConnectionInfo: 'Sem informações de conexão',
    done: 'Feito',
  },

  feed: {
    // Feed notifications for friend requests and acceptances
    friendRequestFrom: ({ name }: { name: string }) => `${name} enviou-lhe um pedido de amizade`,
    friendRequestGeneric: 'Novo pedido de amizade',
    friendAccepted: ({ name }: { name: string }) => `Agora você é amigo de ${name}`,
    friendAcceptedGeneric: 'Pedido de amizade aceito',
  },

  voiceStatusBar: {
    connecting: 'Conectando...',
    reconnecting: 'Reconectando...',
    active: 'Assistente de voz ativo',
    error: 'Erro de conexão',
    default: 'Assistente de voz',
    tapToEnd: 'Toque para encerrar',
  },
} as const;

export type TranslationsPt = typeof pt;
