import type { TranslationStructure } from '../_default';

/**
 * Polish plural helper function
 * Polish has 3 plural forms: one, few, many
 * @param options - Object containing count and the three plural forms
 * @returns The appropriate form based on Polish plural rules
 */
function plural({
  count,
  one,
  few,
  many,
}: {
  count: number;
  one: string;
  few: string;
  many: string;
}): string {
  const n = Math.abs(count);
  const n10 = n % 10;
  const n100 = n % 100;

  // Rule: 1 (but not 11)
  if (n === 1) return one;

  // Rule: 2-4 but not 12-14
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;

  // Rule: everything else (0, 5-19, 11, 12-14, etc.)
  return many;
}

/**
 * Polish translations for the Free app
 * Must match the exact structure of the English translations
 */
export const pl: TranslationStructure = {
  tabs: {
    // Tab navigation labels
    inbox: 'Skrzynka',
    sessions: 'Sesje',
    settings: 'Ustawienia',
  },

  inbox: {
    // Inbox screen
    emptyTitle: 'Pusta skrzynka',
    emptyDescription: 'Połącz się z przyjaciółmi, aby zacząć udostępniać sesje',
    updates: 'Aktualizacje',
  },

  common: {
    // Simple string constants
    cancel: 'Anuluj',
    authenticate: 'Uwierzytelnij',
    save: 'Zapisz',
    saveAs: 'Zapisz jako',
    error: 'Błąd',
    success: 'Sukces',
    ok: 'OK',
    continue: 'Kontynuuj',
    back: 'Wstecz',
    create: 'Utwórz',
    rename: 'Zmień nazwę',
    reset: 'Resetuj',
    logout: 'Wyloguj',
    yes: 'Tak',
    no: 'Nie',
    discard: 'Odrzuć',
    version: 'Wersja',
    copied: 'Skopiowano',
    copy: 'Kopiuj',
    scanning: 'Skanowanie...',
    urlPlaceholder: 'https://example.com',
    home: 'Główna',
    message: 'Wiadomość',
    files: 'Pliki',
    fileViewer: 'Przeglądarka plików',
    loading: 'Ładowanie...',
    retry: 'Ponów',
    delete: 'Usuń',
    optional: 'opcjonalnie',
  },

  profile: {
    userProfile: 'Profil użytkownika',
    details: 'Szczegóły',
    firstName: 'Imię',
    lastName: 'Nazwisko',
    username: 'Nazwa użytkownika',
    status: 'Status',
  },

  status: {
    connected: 'połączono',
    connecting: 'łączenie',
    disconnected: 'rozłączono',
    error: 'błąd',
    authError: 'sesja wygasła, wylogowywanie...',
    online: 'online',
    offline: 'offline',
    lastSeen: ({ time }: { time: string }) => `ostatnio widziano ${time}`,
    permissionRequired: 'wymagane uprawnienie',
    recoveryFailed: 'odzyskiwanie nie powiodło się',
    activeNow: 'Aktywny teraz',
    unknown: 'nieznane',
    machinesOnline: ({ count }: { count: number }) =>
      count === 0 ? 'brak maszyn' : `${count} ${count === 1 ? 'maszyna' : count < 5 ? 'maszyny' : 'maszyn'} online`,
  },

  time: {
    justNow: 'teraz',
    minutesAgo: ({ count }: { count: number }) =>
      `${count} ${plural({ count, one: 'minuta', few: 'minuty', many: 'minut' })} temu`,
    hoursAgo: ({ count }: { count: number }) =>
      `${count} ${plural({ count, one: 'godzina', few: 'godziny', many: 'godzin' })} temu`,
  },

  connect: {
    restoreAccount: 'Przywróć konto',
    enterSecretKey: 'Proszę wprowadzić klucz tajny',
    invalidSecretKey: 'Nieprawidłowy klucz tajny. Sprawdź i spróbuj ponownie.',
    enterUrlManually: 'Wprowadź URL ręcznie',
    connectName: ({ name }: { name: string }) => `Połącz z ${name}`,
    runCommandInTerminal: 'Uruchom następujące polecenie w terminalu:',
  },

  restore: {
    enterSecretKeyInstruction: 'Wprowadź swój klucz tajny, aby przywrócić dostęp do konta.',
    secretKeyPlaceholder: 'XXXXX-XXXXX-XXXXX...',
    qrStep1: '1. Otwórz Free na urządzeniu mobilnym',
    qrStep2: '2. Przejdź do Ustawienia → Konto',
    qrStep3: '3. Dotknij „Połącz nowe urządzenie"',
    qrStep4: '4. Zeskanuj ten kod QR',
    restoreWithSecretKeyInstead: 'Przywróć za pomocą klucza tajnego',
  },

  support: {
    tierCoffee: 'Kawowy kompan',
    tierCoffeePrice: '¥12',
    tierCoffeePeriod: '/mies.',
    tierCoffeeDescription: 'Kawa na wsparcie rozwoju',
    tierCoffeeFeature1: 'Brak odznaki sponsora w aplikacji',
    tierCoffeeFeature2: 'Wczesny dostęp do nowych funkcji',
    tierBuilder: 'Budowniczy',
    tierBuilderPrice: '¥38',
    tierBuilderPeriod: '/mies.',
    tierBuilderDescription: 'Kształtuj przyszłość programowania razem z nami',
    tierBuilderFeature1: 'Wszystkie korzyści Kawowego kompana',
    tierBuilderFeature2: 'Ekskluzywny kanał Discord',
    tierBuilderFeature3: 'Comiesięczna konsultacja 1 na 1',
    tierPioneer: 'Pionier',
    tierPioneerPrice: '¥98',
    tierPioneerPeriod: '/mies.',
    tierPioneerDescription: 'Ekskluzywne doświadczenie dla pionierów',
    tierPioneerFeature1: 'Wszystkie korzyści Budowniczego',
    tierPioneerFeature2: 'Wczesny dostęp do eksperymentalnych funkcji',
    tierPioneerFeature3: 'Priorytet dla niestandardowych żądań',
    tierPioneerFeature4: 'Dedykowane doradztwo techniczne',
    title: 'Wsparcie',
    thankYouTitle: 'Dziękujemy',
    purchaseSuccess: ({ name }: { name: string }) => `Jesteś teraz「${name}」. Dziękujemy za wsparcie!`,
    purchaseFailed: 'Zakup nie powiódł się',
    unknownError: 'Nieznany błąd, spróbuj ponownie',
    thankYouMessage: 'Dziękujemy za wsparcie',
    thankYouDescription: 'Jesteś cennym Budowniczym. Twoje wsparcie napędza naszą innowację.',
    supportDevelopment: 'Wesprzyj rozwój',
    supportDescription: 'Twoje wsparcie napędza naszą innowację. Wybierz plan, który Ci odpowiada i kształtuj przyszłość programowania razem z nami.',
    recommended: 'Polecane',
    processing: 'Przetwarzanie...',
    joinTier: ({ name, price, period }: { name: string; price: string; period: string }) => `Dołącz do ${name} · ${price}${period}`,
    cancellableSecurePayment: 'Anuluj w dowolnym momencie · Bezpieczna płatność',
  },

  settings: {
    title: 'Ustawienia',
    connectedAccounts: 'Połączone konta',
    connectAccount: 'Połącz konto',
    github: 'GitHub',
    machines: 'Maszyny',
    features: 'Funkcje',
    social: 'Społeczność',
    account: 'Konto',
    accountSubtitle: 'Zarządzaj szczegółami konta',
    appearance: 'Wygląd',
    appearanceSubtitle: 'Dostosuj wygląd aplikacji',
    featuresTitle: 'Funkcje',
    featuresSubtitle: 'Włącz lub wyłącz funkcje aplikacji',
    developer: 'Deweloper',
    exitDeveloperMode: 'Wyjdź z trybu dewelopera',
    developerTools: 'Narzędzia deweloperskie',
    about: 'O aplikacji',
    aboutFooter:
      'Free Coder to mobilny klient Codex i Claude Code. Jest w pełni szyfrowany end-to-end, a Twoje konto jest przechowywane tylko na Twoim urządzeniu. Nie jest powiązany z Anthropic.',
    whatsNew: 'Co nowego',
    whatsNewSubtitle: 'Zobacz najnowsze aktualizacje i ulepszenia',
    reportIssue: 'Zgłoś problem',
    privacyPolicy: 'Polityka prywatności',
    termsOfService: 'Warunki użytkowania',
    eula: 'EULA',
    scanQrCodeToAuthenticate: 'Zeskanuj kod QR, aby się uwierzytelnić',
    githubConnected: ({ login }: { login: string }) => `Połączono jako @${login}`,
    connectGithubAccount: 'Połącz konto GitHub',
    claudeAuthSuccess: 'Pomyślnie połączono z Claude',
    exchangingTokens: 'Wymiana tokenów...',
    usage: 'Użycie',
    usageSubtitle: 'Zobacz użycie API i koszty',
    supportUs: 'Dołącz do nas',
    supportUsSubtitlePro: 'Jesteś Budowniczym 🎉',
    supportUsSubtitle: 'Bądź częścią przyszłości',

    // Dynamic settings messages
    accountConnected: ({ service }: { service: string }) => `Konto ${service} połączone`,
    machineStatus: ({ name, status }: { name: string; status: 'online' | 'offline' }) =>
      `${name} jest ${status === 'online' ? 'online' : 'offline'}`,
    featureToggled: ({ feature, enabled }: { feature: string; enabled: boolean }) =>
      `${feature} ${enabled ? 'włączona' : 'wyłączona'}`,
  },

  settingsAppearance: {
    // Appearance settings screen
    theme: 'Motyw',
    themeDescription: 'Wybierz preferowaną kolorystykę',
    themeOptions: {
      adaptive: 'Adaptacyjny',
      light: 'Jasny',
      dark: 'Ciemny',
    },
    themeDescriptions: {
      adaptive: 'Dopasuj do ustawień systemu',
      light: 'Zawsze używaj jasnego motywu',
      dark: 'Zawsze używaj ciemnego motywu',
    },
    display: 'Wyświetlanie',
    displayDescription: 'Kontroluj układ i odstępy',
    inlineToolCalls: 'Wbudowane wywołania narzędzi',
    inlineToolCallsDescription: 'Wyświetlaj wywołania narzędzi bezpośrednio w wiadomościach czatu',
    expandTodoLists: 'Rozwiń listy zadań',
    expandTodoListsDescription: 'Pokazuj wszystkie zadania zamiast tylko zmian',
    showLineNumbersInDiffs: 'Pokaż numery linii w różnicach',
    showLineNumbersInDiffsDescription: 'Wyświetlaj numery linii w różnicach kodu',
    showLineNumbersInToolViews: 'Pokaż numery linii w widokach narzędzi',
    showLineNumbersInToolViewsDescription: 'Wyświetlaj numery linii w różnicach widoków narzędzi',
    wrapLinesInDiffs: 'Zawijanie linii w różnicach',
    wrapLinesInDiffsDescription:
      'Zawijaj długie linie zamiast przewijania poziomego w widokach różnic',
    alwaysShowContextSize: 'Zawsze pokazuj rozmiar kontekstu',
    alwaysShowContextSizeDescription:
      'Wyświetlaj użycie kontekstu nawet gdy nie jest blisko limitu',
    avatarStyle: 'Styl awatara',
    avatarStyleDescription: 'Wybierz wygląd awatara sesji',
    avatarOptions: {
      pixelated: 'Pikselowy',
      gradient: 'Gradientowy',
      brutalist: 'Brutalistyczny',
    },
    showFlavorIcons: 'Pokaż ikony dostawcy AI',
    showFlavorIconsDescription: 'Wyświetlaj ikony dostawcy AI na awatarach sesji',
    compactSessionView: 'Kompaktowy widok sesji',
    compactSessionViewDescription: 'Pokazuj aktywne sesje w bardziej zwartym układzie',
  },

  settingsFeatures: {
    // Features settings screen
    experiments: 'Eksperymenty',
    experimentsDescription:
      'Włącz eksperymentalne funkcje, które są nadal w rozwoju. Te funkcje mogą być niestabilne lub zmienić się bez ostrzeżenia.',
    experimentalFeatures: 'Funkcje eksperymentalne',
    experimentalFeaturesEnabled: 'Funkcje eksperymentalne włączone',
    experimentalFeaturesDisabled: 'Używane tylko stabilne funkcje',
    webFeatures: 'Funkcje webowe',
    webFeaturesDescription: 'Funkcje dostępne tylko w wersji webowej aplikacji.',
    enterToSend: 'Enter aby wysłać',
    enterToSendEnabled: 'Naciśnij Enter, aby wysłać (Shift+Enter dla nowej linii)',
    enterToSendDisabled: 'Enter wstawia nową linię',
    commandPalette: 'Paleta poleceń',
    commandPaletteEnabled: 'Naciśnij ⌘K, aby otworzyć',
    commandPaletteDisabled: 'Szybki dostęp do poleceń wyłączony',
    markdownCopyV2: 'Markdown Copy v2',
    markdownCopyV2Subtitle: 'Długie naciśnięcie otwiera modal kopiowania',
    hideInactiveSessions: 'Ukryj nieaktywne sesje',
    hideInactiveSessionsSubtitle: 'Wyświetlaj tylko aktywne czaty na liście',
    enhancedSessionWizard: 'Ulepszony kreator sesji',
    enhancedSessionWizardEnabled: 'Aktywny launcher z profilem',
    enhancedSessionWizardDisabled: 'Używanie standardowego launchera sesji',

},

  errors: {
    networkError: 'Wystąpił błąd sieci',
    serverError: 'Wystąpił błąd serwera',
    unknownError: 'Wystąpił nieznany błąd',
    connectionTimeout: 'Przekroczono czas oczekiwania na połączenie',
    authenticationFailed: 'Uwierzytelnienie nie powiodło się',
    permissionDenied: 'Brak uprawnień',
    fileNotFound: 'Plik nie został znaleziony',
    invalidFormat: 'Nieprawidłowy format',
    operationFailed: 'Operacja nie powiodła się',
    tryAgain: 'Spróbuj ponownie',
    contactSupport: 'Skontaktuj się z pomocą techniczną, jeśli problem będzie się powtarzał',
    sessionNotFound: 'Sesja nie została znaleziona',
    voiceSessionFailed: 'Nie udało się uruchomić sesji głosowej',
    voiceServiceUnavailable: 'Usługa głosowa jest tymczasowo niedostępna',
    voiceNotConfigured: 'Voice feature is not configured. Please contact support.',
    voiceNotInitialized:
      'Voice service failed to initialize. Please restart the app and try again.',
    voiceMicPermissionWeb:
      'Microphone access is required for voice. Please allow microphone permission in your browser settings.',
    voiceTokenRejected: 'Voice service is not available on this server.',
    oauthInitializationFailed: 'Nie udało się zainicjować przepływu OAuth',
    tokenStorageFailed: 'Nie udało się zapisać tokenów uwierzytelniania',
    oauthStateMismatch: 'Weryfikacja bezpieczeństwa nie powiodła się. Spróbuj ponownie',
    tokenExchangeFailed: 'Nie udało się wymienić kodu autoryzacji',
    oauthAuthorizationDenied: 'Autoryzacja została odrzucona',
    webViewLoadFailed: 'Nie udało się załadować strony uwierzytelniania',
    failedToLoadProfile: 'Nie udało się załadować profilu użytkownika',
    userNotFound: 'Użytkownik nie został znaleziony',
    sessionDeleted: 'Sesja została usunięta',
    sessionDeletedDescription: 'Ta sesja została trwale usunięta',

    // Error functions with context
    fieldError: ({ field, reason }: { field: string; reason: string }) => `${field}: ${reason}`,
    validationError: ({ field, min, max }: { field: string; min: number; max: number }) =>
      `${field} musi być między ${min} a ${max}`,
    retryIn: ({ seconds }: { seconds: number }) =>
      `Ponów próbę za ${seconds} ${plural({ count: seconds, one: 'sekundę', few: 'sekundy', many: 'sekund' })}`,
    errorWithCode: ({ message, code }: { message: string; code: number | string }) =>
      `${message} (Błąd ${code})`,
    disconnectServiceFailed: ({ service }: { service: string }) =>
      `Nie udało się rozłączyć ${service}`,
    connectServiceFailed: ({ service }: { service: string }) =>
      `Nie udało się połączyć z ${service}. Spróbuj ponownie.`,
    failedToLoadFriends: 'Nie udało się załadować listy przyjaciół',
    failedToAcceptRequest: 'Nie udało się zaakceptować zaproszenia do znajomych',
    failedToRejectRequest: 'Nie udało się odrzucić zaproszenia do znajomych',
    failedToRemoveFriend: 'Nie udało się usunąć przyjaciela',
    searchFailed: 'Wyszukiwanie nie powiodło się. Spróbuj ponownie.',
    failedToSendRequest: 'Nie udało się wysłać zaproszenia do znajomych',
  },

  newSession: {
    // Used by new-session screen and launch flows
    title: 'Rozpocznij nową sesję',
    noMachinesFound: 'Nie znaleziono maszyn. Najpierw uruchom sesję Free na swoim komputerze.',
    allMachinesOffline: 'Wszystkie maszyny są offline',
    machineDetails: 'Zobacz szczegóły maszyny →',
    directoryDoesNotExist: 'Katalog nie został znaleziony',
    createDirectoryConfirm: ({ directory }: { directory: string }) =>
      `Katalog ${directory} nie istnieje. Czy chcesz go utworzyć?`,
    sessionStarted: 'Sesja rozpoczęta',
    sessionStartedMessage: 'Sesja została pomyślnie rozpoczęta.',
    sessionSpawningFailed: 'Tworzenie sesji nie powiodło się - nie zwrócono ID sesji.',
    failedToStart:
      'Nie udało się uruchomić sesji. Upewnij się, że daemon działa na docelowej maszynie.',
    sessionTimeout:
      'Przekroczono czas uruchamiania sesji. Maszyna może działać wolno lub daemon może nie odpowiadać.',
    notConnectedToServer: 'Brak połączenia z serwerem. Sprawdź połączenie internetowe.',
    startingSession: 'Rozpoczynanie sesji...',
    startNewSessionInFolder: 'Nowa sesja tutaj',
    noMachineSelected: 'Proszę wybrać maszynę do rozpoczęcia sesji',
    noPathSelected: 'Proszę wybrać katalog do rozpoczęcia sesji',
    sessionType: {
      title: 'Typ sesji',
      simple: 'Prosta',
      worktree: 'Worktree',
      comingSoon: 'Wkrótce dostępne',
    },
    worktree: {
      creating: ({ name }: { name: string }) => `Tworzenie worktree '${name}'...`,
      notGitRepo: 'Worktree wymaga repozytorium git',
      failed: ({ error }: { error: string }) => `Nie udało się utworzyć worktree: ${error}`,
      success: 'Worktree został utworzony pomyślnie',
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
    inputPlaceholder: 'Nad czym chciałbyś pracować?',
    capabilityDiscoveryNotice:
      'Wyślij pierwszą wiadomość, aby załadować tryby, modele i polecenia.',
  },

  agentPicker: {
    headerTitle: 'Wybierz agenta',
    heroEyebrow: 'Selektor implementacji',
    heroTitle: 'Wybierz środowisko uruchomieniowe, z którym chcesz rozpocząć.',
    heroDescription:
      'Każda poniższa opcja jest wykrywana z zarejestrowanych implementacji na wybranej maszynie. Wpisy klasyczne i ACP są celowo utrzymywane oddzielnie.',
    experimentalSection: 'Eksperymentalne',
    experimentalCaption: 'Opcjonalni agenci za ustawieniem eksperymentów.',
    noAgentsTitle: 'Brak dostępnych agentów',
    noAgentsDescription: 'Ta maszyna nie zgłosiła żadnych uruchamialnych implementacji.',
    tagAcp: 'ACP',
    tagClassic: 'Klasyczny',
    tagAnthropic: 'Anthropic',
    tagOpenAI: 'OpenAI',
    tagGoogle: 'Google',
    tagTerminal: 'Terminal',
    tagExperimental: 'Eksperymentalny',
  },

  machinePicker: {
    headerTitle: 'Wybierz maszynę',
    noMachinesAvailable: 'Brak dostępnych maszyn',
    online: 'online',
    offline: 'offline',
    searchPlaceholder: 'Wpisz, aby filtrować maszyny...',
    recentSection: 'Ostatnie maszyny',
    favoritesSection: 'Ulubione maszyny',
    allSection: 'Wszystkie urządzenia',
  },

  pathPicker: {
    headerTitle: 'Wybierz ścieżkę',
    noMachineSelected: 'Nie wybrano maszyny',
    enterPath: 'Wprowadź ścieżkę',
    enterPathPlaceholder: 'Wprowadź ścieżkę (np. /home/user/projects)',
    recentPaths: 'Ostatnie ścieżki',
    suggestedPaths: 'Sugerowane ścieżki',
    browse: 'Przeglądaj',
    browseError: 'Nie można załadować katalogu',
    emptyDirectory: 'Brak podkatalogów',
  },

  sessionHistory: {
    // Used by session history screen
    title: 'Historia sesji',
    empty: 'Nie znaleziono sesji',
    today: 'Dzisiaj',
    yesterday: 'Wczoraj',
    daysAgo: ({ count }: { count: number }) =>
      `${count} ${plural({ count, one: 'dzień', few: 'dni', many: 'dni' })} temu`,
    viewAll: 'Zobacz wszystkie sesje',
  },

  session: {
    inputPlaceholder: 'Wpisz wiadomość...',
    sendFailed: 'Wysyłanie nie powiodło się. Dotknij, aby ponowić.',
    sendBlockedServerDisconnected: 'Serwer rozłączony, nie można wysłać wiadomości',
    sendBlockedDaemonOffline: 'Sesja offline, nie można wysłać wiadomości',
    addImage: 'Dodaj zdjęcie',
    pickLatestPhoto: 'Ostatnie zdjęcie',
    chooseFromLibrary: 'Wybierz z biblioteki',
    latestPhotoUnavailable:
      'Nie udało się wczytać zdjęcia. Zezwól na dostęp do biblioteki lub dodaj zdjęcia.',
  },

  commandPalette: {
    placeholder: 'Wpisz polecenie lub wyszukaj...',
  },

  server: {
    // Used by Server Configuration screen (app/(app)/server.tsx)
    serverConfiguration: 'Konfiguracja serwera',
    enterServerUrl: 'Proszę wprowadzić URL serwera',
    notValidFreeServer: 'To nie jest prawidłowy serwer Free',
    changeServer: 'Zmień serwer',
    continueWithServer: 'Kontynuować z tym serwerem?',
    resetToDefault: 'Resetuj do domyślnego',
    resetServerDefault: 'Zresetować serwer do domyślnego?',
    validating: 'Sprawdzanie...',
    validatingServer: 'Sprawdzanie serwera...',
    serverReturnedError: 'Serwer zwrócił błąd',
    failedToConnectToServer: 'Nie udało się połączyć z serwerem',
    currentlyUsingCustomServer: 'Aktualnie używany jest niestandardowy serwer',
    customServerUrlLabel: 'URL niestandardowego serwera',
    advancedFeatureFooter:
      'To jest zaawansowana funkcja. Zmieniaj serwer tylko jeśli wiesz, co robisz. Po zmianie serwera będziesz musiał się wylogować i zalogować ponownie.',
  },

  sessionInfo: {
    // Used by Session Info screen (app/(app)/session/[id]/info.tsx)
    killSession: 'Zakończ sesję',
    killSessionConfirm: 'Czy na pewno chcesz zakończyć tę sesję?',
    archiveSession: 'Zarchiwizuj sesję',
    archiveSessionConfirm: 'Czy na pewno chcesz zarchiwizować tę sesję?',
    freeSessionIdCopied: 'ID sesji Free skopiowane do schowka',
    failedToCopySessionId: 'Nie udało się skopiować ID sesji Free',
    freeSessionId: 'ID sesji Free',
    agentSessionId: 'ID sesji Claude Code',
    agentSessionIdCopied: 'ID sesji Claude Code skopiowane do schowka',
    aiProvider: 'Dostawca AI',
    failedToCopyAgentSessionId: 'Nie udało się skopiować ID sesji Claude Code',
    metadataCopied: 'Metadane skopiowane do schowka',
    failedToCopyMetadata: 'Nie udało się skopiować metadanych',
    failedToKillSession: 'Nie udało się zakończyć sesji',
    failedToArchiveSession: 'Nie udało się zarchiwizować sesji',
    connectionStatus: 'Status połączenia',
    created: 'Utworzono',
    lastUpdated: 'Ostatnia aktualizacja',
    sequence: 'Sekwencja',
    quickActions: 'Szybkie akcje',
    viewMachine: 'Zobacz maszynę',
    viewMachineSubtitle: 'Zobacz szczegóły maszyny i sesje',
    killSessionSubtitle: 'Natychmiastowo zakończ sesję',
    archiveSessionSubtitle: 'Zarchiwizuj tę sesję i zatrzymaj ją',
    recoveryFailedArchiveSubtitle: 'Ta sesja nie została odzyskana po awarii',
    metadata: 'Metadane',
    host: 'Host',
    path: 'Ścieżka',
    operatingSystem: 'System operacyjny',
    processId: 'ID procesu',
    freeHome: 'Katalog domowy Free',
    copyMetadata: 'Kopiuj metadane',
    agentState: 'Stan agenta',
    controlledByUser: 'Kontrolowany przez użytkownika',
    pendingRequests: 'Oczekujące żądania',
    activity: 'Aktywność',
    thinking: 'Myśli',
    thinkingSince: 'Myśli od',
    cliVersion: 'Wersja CLI',
    cliVersionOutdated: 'Wymagana aktualizacja CLI',
    cliVersionOutdatedMessage: ({
      currentVersion,
      requiredVersion,
    }: {
      currentVersion: string;
      requiredVersion: string;
    }) => `Zainstalowana wersja ${currentVersion}. Zaktualizuj do ${requiredVersion} lub nowszej`,
    updateCliInstructions:
      'Proszę uruchomić npm install -g @saaskit-dev/free',
    restartAgent: 'Wymuś restart agenta',
    restartAgentConfirm: 'Spowoduje to zakończenie bieżącego procesu agenta i uruchomienie nowego. Sesja i historia rozmów zostaną zachowane.',
    restartAgentSubtitle: 'Zakończ i uruchom ponownie proces agenta',
    restartAgentSuccess: 'Proces agenta jest restartowany.',
    failedToRestartAgent: 'Nie udało się zrestartować agenta',
    deleteSession: 'Usuń sesję',
    deleteSessionSubtitle: 'Trwale usuń tę sesję',
    deleteSessionConfirm: 'Usunąć sesję na stałe?',
    deleteSessionWarning:
      'Ta operacja jest nieodwracalna. Wszystkie wiadomości i dane powiązane z tą sesją zostaną trwale usunięte.',
    failedToDeleteSession: 'Nie udało się usunąć sesji',
    sessionDeleted: 'Sesja została pomyślnie usunięta',
    clearCache: 'Wyczyść pamięć podręczną',
    clearCacheSubtitle: 'Wyczyść lokalne dane w pamięci podręcznej dla tej sesji',
    clearCacheConfirm: 'Wyczyścić wszystkie dane w pamięci podręcznej dla tej sesji? Wiadomości zostaną ponownie pobrane z serwera.',
    clearCacheSuccess: 'Pamięć podręczna wyczyszczona',
    clearCacheFailed: 'Nie udało się wyczyścić pamięci podręcznej',
  },

  components: {
    emptyMainScreen: {
      // Used by EmptyMainScreen component
      readyToCode: 'Gotowy do kodowania?',
      installCli: 'Zainstaluj Free CLI',
      runIt: 'Uruchom je',
      scanQrCode: 'Zeskanuj kod QR',
      openCamera: 'Otwórz kamerę',
    },
  },

  agentInput: {
    permissionMode: {
      title: 'TRYB UPRAWNIEŃ',
      readOnly: 'Tylko do odczytu',
      acceptEdits: 'Akceptuj edycje',
      yolo: 'YOLO',
      badgeReadOnly: 'Tylko do odczytu',
      badgeAcceptEdits: 'Akceptuj edycje',
      badgeYolo: 'YOLO',
    },
    agentTitle: 'Agent',
    agentModeTitle: 'Tryb agenta',
    experimentalSection: 'Eksperymentalne',
    agent: {
      claude: 'Claude',
      codex: 'Codex',
      gemini: 'Gemini',
      opencode: 'OpenCode',
    },
    model: {
      title: 'MODEL',
      configureInCli: 'Skonfiguruj modele w ustawieniach CLI',
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
      remaining: ({ percent }: { percent: number }) => `Pozostało ${percent}%`,
    },
    suggestion: {
      fileLabel: 'PLIK',
      folderLabel: 'FOLDER',
    },
    noMachinesAvailable: 'Brak maszyn',
    abortConfirmTitle: 'Zatrzymać bieżącą odpowiedź?',
    abortConfirmMessage: 'Agent przestanie pracować nad tą odpowiedzią.',
    abortConfirmAction: 'Zatrzymaj',
    abortTimedOut:
      'Żądanie zatrzymania przekroczyło limit czasu. Sprawdź połączenie i spróbuj ponownie.',
    speechInput: {
      recording: 'Słucham...',
      permissionTitle: 'Wymagany dostęp do mikrofonu',
      permissionMessage: 'Zezwól na dostęp do mikrofonu i rozpoznawania mowy w ustawieniach systemowych.',
      permissionCancel: 'Anuluj',
      permissionOpenSettings: 'Otwórz ustawienia',
      errorTitle: 'Błąd rozpoznawania mowy',
      errorMessage: ({ error }: { error: string }) => `Nie można uruchomić rozpoznawania mowy (${error}).`,
      languageUnavailableTitle: 'Pakiet językowy nie jest zainstalowany',
      languageUnavailableMessage: 'Pakiet rozpoznawania mowy dla wybranego języka nie został pobrany. Otwórz ustawienia, aby go zainstalować, lub przełącz się na angielski.',
      languageUnavailableCancel: 'Anuluj',
      languageUnavailableOpenSettings: 'Otwórz ustawienia',
      languageUnavailableUseEnglish: 'Użyj angielskiego',
    },
  },

  machineLauncher: {
    showLess: 'Pokaż mniej',
    showAll: ({ count }: { count: number }) =>
      `Pokaż wszystkie (${count} ${plural({ count, one: 'ścieżka', few: 'ścieżki', many: 'ścieżek' })})`,
    enterCustomPath: 'Wprowadź niestandardową ścieżkę',
    offlineUnableToSpawn: 'Nie można utworzyć nowej sesji, offline',
  },

  sidebar: {
    sessionsTitle: 'Free',
  },

  toolView: {
    input: 'Wejście',
    output: 'Wyjście',
  },

  tools: {
    fullView: {
      description: 'Opis',
      inputParams: 'Parametry wejściowe',
      output: 'Wyjście',
      error: 'Błąd',
      completed: 'Narzędzie ukończone pomyślnie',
      noOutput: 'Nie wygenerowano żadnego wyjścia',
      running: 'Narzędzie działa...',
      rawJsonDevMode: 'Surowy JSON (tryb deweloperski)',
    },
    taskView: {
      initializing: 'Inicjalizacja agenta...',
      moreTools: ({ count }: { count: number }) =>
        `+${count} ${plural({ count, one: 'więcej narzędzie', few: 'więcej narzędzia', many: 'więcej narzędzi' })}`,
    },
    multiEdit: {
      editNumber: ({ index, total }: { index: number; total: number }) =>
        `Edycja ${index} z ${total}`,
      replaceAll: 'Zamień wszystkie',
    },
    names: {
      task: 'Zadanie',
      terminal: 'Terminal',
      searchFiles: 'Wyszukaj pliki',
      search: 'Wyszukaj',
      searchContent: 'Wyszukaj zawartość',
      listFiles: 'Lista plików',
      planProposal: 'Propozycja planu',
      readFile: 'Czytaj plik',
      editFile: 'Edytuj plik',
      writeFile: 'Zapisz plik',
      fetchUrl: 'Pobierz URL',
      readNotebook: 'Czytaj notatnik',
      editNotebook: 'Edytuj notatnik',
      todoList: 'Lista zadań',
      webSearch: 'Wyszukiwanie w sieci',
      toolSearch: 'Wyszukiwanie narzędzi',
      reasoning: 'Rozumowanie',
      applyChanges: 'Zaktualizuj plik',
      viewDiff: 'Bieżące zmiany pliku',
      question: 'Pytanie',
    },
    desc: {
      terminalCmd: ({ cmd }: { cmd: string }) => `Terminal(cmd: ${cmd})`,
      searchPattern: ({ pattern }: { pattern: string }) => `Wyszukaj(wzorzec: ${pattern})`,
      searchPath: ({ basename }: { basename: string }) => `Wyszukaj(ścieżka: ${basename})`,
      fetchUrlHost: ({ host }: { host: string }) => `Pobierz URL(url: ${host})`,
      editNotebookMode: ({ path, mode }: { path: string; mode: string }) =>
        `Edytuj notatnik(plik: ${path}, tryb: ${mode})`,
      todoListCount: ({ count }: { count: number }) => `Lista zadań(liczba: ${count})`,
      webSearchQuery: ({ query }: { query: string }) => `Wyszukiwanie w sieci(zapytanie: ${query})`,
      grepPattern: ({ pattern }: { pattern: string }) => `grep(wzorzec: ${pattern})`,
      multiEditEdits: ({ path, count }: { path: string; count: number }) =>
        `${path} (${count} ${plural({ count, one: 'edycja', few: 'edycje', many: 'edycji' })})`,
      readingFile: ({ file }: { file: string }) => `Odczytywanie ${file}`,
      writingFile: ({ file }: { file: string }) => `Zapisywanie ${file}`,
      modifyingFile: ({ file }: { file: string }) => `Modyfikowanie ${file}`,
      modifyingFiles: ({ count }: { count: number }) =>
        `Modyfikowanie ${count} ${plural({ count, one: 'pliku', few: 'plików', many: 'plików' })}`,
      modifyingMultipleFiles: ({ file, count }: { file: string; count: number }) =>
        `${file} i ${count} ${plural({ count, one: 'więcej', few: 'więcej', many: 'więcej' })}`,
      showingDiff: 'Pokazywanie zmian',
    },
    askUserQuestion: {
      submit: 'Wyślij odpowiedź',
      multipleQuestions: ({ count }: { count: number }) =>
        `${count} ${plural({ count, one: 'pytanie', few: 'pytania', many: 'pytań' })}`,
      other: 'Inne',
      otherDescription: 'Wpisz własną odpowiedź',
      otherPlaceholder: 'Wpisz swoją odpowiedź...',
    },
  },

  files: {
    searchPlaceholder: 'Wyszukaj pliki...',
    detachedHead: 'odłączony HEAD',
    summary: ({ staged, unstaged }: { staged: number; unstaged: number }) =>
      `${staged} przygotowanych • ${unstaged} nieprzygotowanych`,
    notRepo: 'To nie jest repozytorium git',
    notUnderGit: 'Ten katalog nie jest pod kontrolą wersji git',
    searching: 'Wyszukiwanie plików...',
    noFilesFound: 'Nie znaleziono plików',
    noFilesInProject: 'Brak plików w projekcie',
    tryDifferentTerm: 'Spróbuj innego terminu wyszukiwania',
    searchResults: ({ count }: { count: number }) => `Wyniki wyszukiwania (${count})`,
    projectRoot: 'Katalog główny projektu',
    stagedChanges: ({ count }: { count: number }) => `Przygotowane zmiany (${count})`,
    unstagedChanges: ({ count }: { count: number }) => `Nieprzygotowane zmiany (${count})`,
    // File viewer strings
    loadingFile: ({ fileName }: { fileName: string }) => `Ładowanie ${fileName}...`,
    binaryFile: 'Plik binarny',
    cannotDisplayBinary: 'Nie można wyświetlić zawartości pliku binarnego',
    tapImageToZoom: 'Dotknij obrazu, aby powiększyć',
    diff: 'Różnice',
    file: 'Plik',
    fileEmpty: 'Plik jest pusty',
    noChanges: 'Brak zmian do wyświetlenia',
    failedToDecodeContent: 'Nie udało się zdekodować zawartości pliku',
    failedToReadFile: 'Nie udało się odczytać pliku',
    failedToLoadFile: 'Nie udało się załadować pliku',
    pathCopied: 'Skopiowano ścieżkę',
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
    download: 'Pobierz',
    downloadFolder: 'Pobierz jako ZIP',
    delete: 'Usuń',
    deleteFileConfirm: ({ name }: { name: string }) => `Delete "${name}"? This cannot be undone.`,
    deleteFolderConfirm: ({ name }: { name: string }) => `Delete folder "${name}" and all its contents? This cannot be undone.`,
    deleteSuccess: 'Usunięto pomyślnie',
    deleteError: 'Nie udało się usunąć',
    downloadError: 'Nie udało się pobrać pliku',
    fileTooLargeToDownload: 'Plik jest zbyt duży do pobrania (maks. 10 MB)',
    downloadFolderError: 'Nie udało się pobrać folderu',
    preparingDownload: 'Przygotowywanie pobierania...',
    actions: 'Akcje',
  },

  settingsAccount: {
    // Account settings screen
    accountInformation: 'Informacje o koncie',
    status: 'Status',
    statusActive: 'Aktywny',
    statusNotAuthenticated: 'Nie uwierzytelniony',
    anonymousId: 'ID anonimowe',
    publicId: 'ID publiczne',
    notAvailable: 'Niedostępne',
    linkNewDevice: 'Połącz nowe urządzenie',
    linkNewDeviceSubtitle: 'Zeskanuj kod QR, aby połączyć urządzenie',
    profile: 'Profil',
    name: 'Nazwa',
    github: 'GitHub',
    tapToDisconnect: 'Dotknij, aby rozłączyć',
    server: 'Serwer',
    backup: 'Kopia zapasowa',
    backupDescription:
      'Twój klucz tajny to jedyny sposób na odzyskanie konta. Zapisz go w bezpiecznym miejscu, takim jak menedżer haseł.',
    secretKey: 'Klucz tajny',
    tapToReveal: 'Dotknij, aby pokazać',
    tapToHide: 'Dotknij, aby ukryć',
    secretKeyLabel: 'KLUCZ TAJNY (DOTKNIJ, ABY SKOPIOWAĆ)',
    secretKeyCopied: 'Klucz tajny skopiowany do schowka. Przechowuj go w bezpiecznym miejscu!',
    secretKeyCopyFailed: 'Nie udało się skopiować klucza tajnego',
    privacy: 'Prywatność',
    privacyDescription:
      'Pomóż ulepszyć aplikację, udostępniając anonimowe dane o użytkowaniu. Nie zbieramy żadnych informacji osobistych.',
    analytics: 'Analityka',
    analyticsDisabled: 'Dane nie są udostępniane',
    analyticsEnabled: 'Anonimowe dane o użytkowaniu są udostępniane',
    dangerZone: 'Strefa niebezpieczna',
    logout: 'Wyloguj',
    logoutSubtitle: 'Wyloguj się i wyczyść dane lokalne',
    logoutConfirm:
      'Czy na pewno chcesz się wylogować? Upewnij się, że masz kopię zapasową klucza tajnego!',
  },

  settingsLanguage: {
    // Language settings screen
    title: 'Język',
    description:
      'Wybierz preferowany język interfejsu aplikacji. To ustawienie zostanie zsynchronizowane na wszystkich Twoich urządzeniach.',
    currentLanguage: 'Aktualny język',
    automatic: 'Automatycznie',
    automaticSubtitle: 'Wykrywaj na podstawie ustawień urządzenia',
    needsRestart: 'Język zmieniony',
    needsRestartMessage:
      'Aplikacja musi zostać uruchomiona ponownie, aby zastosować nowe ustawienia języka.',
    restartNow: 'Uruchom ponownie',
  },

  connectButton: {
    authenticate: 'Uwierzytelnij terminal',
    authenticateWithUrlPaste: 'Uwierzytelnij terminal poprzez wklejenie URL',
    pasteAuthUrl: 'Wklej URL uwierzytelnienia z terminala',
  },

  updateBanner: {
    updateAvailable: 'Dostępna aktualizacja',
    pressToApply: 'Naciśnij, aby zastosować aktualizację',
    whatsNew: 'Co nowego',
    seeLatest: 'Zobacz najnowsze aktualizacje i ulepszenia',
    nativeUpdateAvailable: 'Dostępna aktualizacja aplikacji',
    tapToUpdateAppStore: 'Naciśnij, aby zaktualizować w App Store',
    tapToUpdatePlayStore: 'Naciśnij, aby zaktualizować w Sklepie Play',
  },

  changelog: {
    // Used by the changelog screen
    version: ({ version }: { version: number }) => `Wersja ${version}`,
    noEntriesAvailable: 'Brak dostępnych wpisów dziennika zmian.',
  },

  terminal: {
    // Used by terminal connection screens
    webBrowserRequired: 'Wymagana przeglądarka internetowa',
    webBrowserRequiredDescription:
      'Linki połączenia terminala można otwierać tylko w przeglądarce internetowej ze względów bezpieczeństwa. Użyj skanera kodów QR lub otwórz ten link na komputerze.',
    processingConnection: 'Przetwarzanie połączenia...',
    invalidConnectionLink: 'Nieprawidłowy link połączenia',
    invalidConnectionLinkDescription:
      'Link połączenia jest nieprawidłowy lub go brakuje. Sprawdź URL i spróbuj ponownie.',
    connectTerminal: 'Połącz terminal',
    terminalRequestDescription:
      'Terminal żąda połączenia z Twoim kontem Free Coder. Pozwoli to terminalowi bezpiecznie wysyłać i odbierać wiadomości.',
    connectionDetails: 'Szczegóły połączenia',
    publicKey: 'Klucz publiczny',
    encryption: 'Szyfrowanie',
    endToEndEncrypted: 'Szyfrowanie end-to-end',
    acceptConnection: 'Akceptuj połączenie',
    createAccountAndAccept: 'Utwórz konto i zaakceptuj',
    creatingAccount: 'Tworzenie konta...',
    connecting: 'Łączenie...',
    reject: 'Odrzuć',
    security: 'Bezpieczeństwo',
    securityFooter:
      'Ten link połączenia został bezpiecznie przetworzony w Twojej przeglądarce i nigdy nie został wysłany na żaden serwer. Twoje prywatne dane pozostaną bezpieczne i tylko Ty możesz odszyfrować wiadomości.',
    securityFooterDevice:
      'To połączenie zostało bezpiecznie przetworzone na Twoim urządzeniu i nigdy nie zostało wysłane na żaden serwer. Twoje prywatne dane pozostaną bezpieczne i tylko Ty możesz odszyfrować wiadomości.',
    clientSideProcessing: 'Przetwarzanie po stronie klienta',
    linkProcessedLocally: 'Link przetworzony lokalnie w przeglądarce',
    linkProcessedOnDevice: 'Link przetworzony lokalnie na urządzeniu',
  },

  modals: {
    // Used across connect flows and settings
    authenticateTerminal: 'Uwierzytelnij terminal',
    pasteUrlFromTerminal: 'Wklej URL uwierzytelnienia z terminala',
    deviceLinkedSuccessfully: 'Urządzenie połączone pomyślnie',
    terminalConnectedSuccessfully: 'Terminal połączony pomyślnie',
    invalidAuthUrl: 'Nieprawidłowy URL uwierzytelnienia',
    developerMode: 'Tryb deweloperski',
    developerModeEnabled: 'Tryb deweloperski włączony',
    developerModeDisabled: 'Tryb deweloperski wyłączony',
    disconnectGithub: 'Rozłącz GitHub',
    disconnectGithubConfirm: 'Czy na pewno chcesz rozłączyć swoje konto GitHub?',
    disconnectService: ({ service }: { service: string }) => `Rozłącz ${service}`,
    disconnectServiceConfirm: ({ service }: { service: string }) =>
      `Czy na pewno chcesz rozłączyć ${service} ze swojego konta?`,
    disconnect: 'Rozłącz',
    failedToConnectTerminal: 'Nie udało się połączyć terminala',
    cameraPermissionsRequiredToConnectTerminal:
      'Uprawnienia do kamery są wymagane do połączenia terminala',
    failedToLinkDevice: 'Nie udało się połączyć urządzenia',
    cameraPermissionsRequiredToScanQr: 'Uprawnienia do kamery są wymagane do skanowania kodów QR',
  },

  navigation: {
    // Navigation titles and screen headers
    connectTerminal: 'Połącz terminal',
    linkNewDevice: 'Połącz nowe urządzenie',
    restoreWithSecretKey: 'Przywróć kluczem tajnym',
    whatsNew: 'Co nowego',
    friends: 'Przyjaciele',
    importExistingAgentSessions: 'Importuj istniejące sesje agenta',
    connectTo: ({ name }: { name: string }) => `Połącz z ${name}`,
    developerTools: 'Narzędzia deweloperskie',
    listComponentsDemo: 'Demo komponentów listy',
    typography: 'Typografia',
    colors: 'Kolory',
    toolViewsDemo: 'Demo widoków narzędzi',
    shimmerViewDemo: 'Demo widoku shimmer',
    multiTextInput: 'Wieloliniowe pole tekstowe',
  },

  welcome: {
    // Main welcome screen for unauthenticated users
    title: 'Mobilny klient Codex i Claude Code',
    subtitle: 'Szyfrowanie end-to-end, a Twoje konto jest przechowywane tylko na Twoim urządzeniu.',
    createAccount: 'Utwórz konto',
    linkOrRestoreAccount: 'Połącz lub przywróć konto',
    loginWithMobileApp: 'Zaloguj się przez aplikację mobilną',
  },

  review: {
    // Used by utils/requestReview.ts
    enjoyingApp: 'Podoba Ci się aplikacja?',
    feedbackPrompt: 'Chcielibyśmy usłyszeć Twoją opinię!',
    yesILoveIt: 'Tak, uwielbiam ją!',
    notReally: 'Nie bardzo',
  },

  items: {
    // Used by Item component for copy toast
    copiedToClipboard: ({ label }: { label: string }) => `${label} skopiowano do schowka`,
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
    offlineUnableToSpawn: 'Launcher wyłączony, gdy maszyna jest offline',
    offlineHelp:
      '• Upewnij się, że komputer jest online\n• Uruchom `free daemon status`, aby zdiagnozować\n• Czy używasz najnowszej wersji CLI? Zaktualizuj poleceniem `npm install -g @saaskit-dev/free`',
    launchNewSessionInDirectory: 'Uruchom nową sesję w katalogu',
    enterCustomPath: 'Wprowadź ścieżkę',
    previousSessions: 'Poprzednie sesje (do 5 najnowszych)',
    machineNotFound: 'Nie znaleziono maszyny',
    stopDaemonConfirmTitle: 'Zatrzymać demona?',
    stopDaemonConfirmMessage: 'Nie będziesz mógł tworzyć nowych sesji na tej maszynie, dopóki nie uruchomisz ponownie demona na swoim komputerze. Bieżące sesje pozostaną aktywne.',
    daemonStopped: 'Demon zatrzymany',
    failedToStopDaemon: 'Nie udało się zatrzymać demona. Może nie być uruchomiony.',
    renameMachine: 'Zmień nazwę maszyny',
    renameMachineMessage: 'Nadaj tej maszynie niestandardową nazwę. Pozostaw puste, aby użyć domyślnej nazwy hosta.',
    enterMachineName: 'Wprowadź nazwę maszyny',
    machineRenamed: 'Nazwa maszyny zmieniona pomyślnie',
    createDirectoryTitle: 'Utworzyć katalog?',
    createDirectoryMessage: ({ directory }: { directory: string }) => `Katalog '${directory}' nie istnieje. Czy chcesz go utworzyć?`,
    failedToStartSession: 'Nie udało się uruchomić sesji. Upewnij się, że demon jest uruchomiony na docelowej maszynie.',
    daemon: 'Demon',
    status: 'Status',
    stopDaemon: 'Zatrzymaj demona',
    lastKnownPid: 'Ostatni znany PID',
    lastKnownHttpPort: 'Ostatni znany port HTTP',
    startedAt: 'Uruchomiony o',
    cliVersion: 'Wersja CLI',
    daemonStateVersion: 'Wersja stanu daemon',
    activeSessions: ({ count }: { count: number }) => `Aktywne sesje (${count})`,
    machineGroup: 'Maszyna',
    host: 'Host',
    machineId: 'ID maszyny',
    username: 'Nazwa użytkownika',
    homeDirectory: 'Katalog domowy',
    platform: 'Platforma',
    architecture: 'Architektura',
    lastSeen: 'Ostatnio widziana',
    never: 'Nigdy',
    metadataVersion: 'Wersja metadanych',
    untitledSession: 'Sesja bez nazwy',
    back: 'Wstecz',
  },

  message: {
    switchedToMode: ({ mode }: { mode: string }) => `Przełączono na tryb ${mode}`,
    unknownEvent: 'Nieznane zdarzenie',
    usageLimitUntil: ({ time }: { time: string }) => `Osiągnięto limit użycia do ${time}`,
    unknownTime: 'nieznany czas',
    permissionRequest: ({ toolName }: { toolName: string }) => 'Permission request for ' + toolName,
    permissionMode: ({ mode }: { mode: string }) => 'Permission mode: ' + mode,
  },

  chatList: {
    pullToRefresh: 'Pociągnij, aby odświeżyć',
    releaseToRefresh: 'Puść, aby odświeżyć',
    refreshing: 'Odświeżanie...',
    pullToLoadEarlier: 'Pociągnij, aby załadować wcześniejsze',
    releaseToLoadEarlier: 'Puść, aby załadować wcześniejsze',
    loadingEarlier: 'Ładowanie...',
    navPanelPartialHint:
      'Pokazywane są tylko załadowane wiadomości. Przewiń w górę, aby wczytać wcześniejsze.',
    scrollToBottom: 'Na dół',
    newMessages: ({ count }: { count: number }) =>
      `${count} ${count === 1 ? 'nowa wiadomość' : count < 5 ? 'nowe wiadomości' : 'nowych wiadomości'}`,
    today: 'Dzisiaj',
    yesterday: 'Wczoraj',
  },

  codex: {
    // Codex permission dialog buttons
    permissions: {
      yesForSession: 'Tak, i nie pytaj dla tej sesji',
      stopAndExplain: 'Zatrzymaj i wyjaśnij, co zrobić',
    },
  },

  claude: {
    // Claude permission dialog buttons
    permissions: {
      yesAllowAllEdits: 'Tak, zezwól na wszystkie edycje podczas tej sesji',
      yesForTool: 'Tak, nie pytaj ponownie dla tego narzędzia',
      noTellClaude: 'Nie, przekaż opinię',
    },
  },

  textSelection: {
    // Text selection screen
    selectText: 'Wybierz zakres tekstu',
    title: 'Wybierz tekst',
    noTextProvided: 'Nie podano tekstu',
    textNotFound: 'Tekst nie został znaleziony lub wygasł',
    textCopied: 'Tekst skopiowany do schowka',
    failedToCopy: 'Nie udało się skopiować tekstu do schowka',
    noTextToCopy: 'Brak tekstu do skopiowania',
  },

  markdown: {
    // Markdown copy functionality
    codeCopied: 'Kod skopiowany',
    copyFailed: 'Błąd kopiowania',
    mermaidRenderFailed: 'Nie udało się wyświetlić diagramu mermaid',
  },

  artifacts: {
    // Artifacts feature
    title: 'Artefakty',
    countSingular: '1 artefakt',
    countPlural: ({ count }: { count: number }) => {
      const n = Math.abs(count);
      const n10 = n % 10;
      const n100 = n % 100;

      // Polish plural rules: 1 (singular), 2-4 (few), 5+ (many)
      if (n === 1) {
        return `${count} artefakt`;
      }
      if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) {
        return `${count} artefakty`;
      }
      return `${count} artefaktów`;
    },
    empty: 'Brak artefaktów',
    emptyDescription: 'Utwórz pierwszy artefakt, aby rozpocząć',
    new: 'Nowy artefakt',
    edit: 'Edytuj artefakt',
    delete: 'Usuń',
    updateError: 'Nie udało się zaktualizować artefaktu. Spróbuj ponownie.',
    notFound: 'Artefakt nie został znaleziony',
    discardChanges: 'Odrzucić zmiany?',
    discardChangesDescription: 'Masz niezapisane zmiany. Czy na pewno chcesz je odrzucić?',
    deleteConfirm: 'Usunąć artefakt?',
    deleteConfirmDescription: 'Tej operacji nie można cofnąć',
    titleLabel: 'TYTUŁ',
    titlePlaceholder: 'Wprowadź tytuł dla swojego artefaktu',
    bodyLabel: 'TREŚĆ',
    bodyPlaceholder: 'Napisz swoją treść tutaj...',
    emptyFieldsError: 'Proszę wprowadzić tytuł lub treść',
    createError: 'Nie udało się utworzyć artefaktu. Spróbuj ponownie.',
    save: 'Zapisz',
    saving: 'Zapisywanie...',
    loading: 'Ładowanie artefaktów...',
    error: 'Nie udało się załadować artefaktu',
  },

  friends: {
    // Friends feature
    title: 'Przyjaciele',
    manageFriends: 'Zarządzaj swoimi przyjaciółmi i połączeniami',
    searchTitle: 'Znajdź przyjaciół',
    pendingRequests: 'Zaproszenia do znajomych',
    myFriends: 'Moi przyjaciele',
    noFriendsYet: 'Nie masz jeszcze żadnych przyjaciół',
    findFriends: 'Znajdź przyjaciół',
    remove: 'Usuń',
    pendingRequest: 'Oczekujące',
    sentOn: ({ date }: { date: string }) => `Wysłano ${date}`,
    accept: 'Akceptuj',
    reject: 'Odrzuć',
    addFriend: 'Dodaj do znajomych',
    alreadyFriends: 'Już jesteście znajomymi',
    requestPending: 'Zaproszenie oczekuje',
    searchInstructions: 'Wprowadź nazwę użytkownika, aby znaleźć przyjaciół',
    searchPlaceholder: 'Wprowadź nazwę użytkownika...',
    searching: 'Szukanie...',
    userNotFound: 'Nie znaleziono użytkownika',
    noUserFound: 'Nie znaleziono użytkownika o tej nazwie',
    checkUsername: 'Sprawdź nazwę użytkownika i spróbuj ponownie',
    howToFind: 'Jak znaleźć przyjaciół',
    findInstructions:
      'Szukaj przyjaciół po nazwie użytkownika. Zarówno ty, jak i twój przyjaciel musicie mieć połączony GitHub, aby wysyłać zaproszenia do znajomych.',
    requestSent: 'Zaproszenie do znajomych wysłane!',
    requestAccepted: 'Zaproszenie do znajomych zaakceptowane!',
    requestRejected: 'Zaproszenie do znajomych odrzucone',
    friendRemoved: 'Przyjaciel usunięty',
    confirmRemove: 'Usuń przyjaciela',
    confirmRemoveMessage: 'Czy na pewno chcesz usunąć tego przyjaciela?',
    cannotAddYourself: 'Nie możesz wysłać zaproszenia do siebie',
    bothMustHaveGithub: 'Obaj użytkownicy muszą mieć połączony GitHub, aby zostać przyjaciółmi',
    status: {
      none: 'Nie połączono',
      requested: 'Zaproszenie wysłane',
      pending: 'Zaproszenie oczekuje',
      friend: 'Przyjaciele',
      rejected: 'Odrzucone',
    },
    acceptRequest: 'Zaakceptuj zaproszenie',
    removeFriend: 'Usuń z przyjaciół',
    removeFriendConfirm: ({ name }: { name: string }) =>
      `Czy na pewno chcesz usunąć ${name} z przyjaciół?`,
    requestSentDescription: ({ name }: { name: string }) =>
      `Twoje zaproszenie do grona przyjaciół zostało wysłane do ${name}`,
    requestFriendship: 'Wyślij zaproszenie do znajomych',
    cancelRequest: 'Anuluj zaproszenie do znajomych',
    cancelRequestConfirm: ({ name }: { name: string }) =>
      `Anulować zaproszenie do znajomych wysłane do ${name}?`,
    denyRequest: 'Odrzuć zaproszenie',
    nowFriendsWith: ({ name }: { name: string }) => `Teraz jesteś w gronie znajomych z ${name}`,
  },

  usage: {
    // Usage panel strings
    today: 'Dzisiaj',
    last7Days: 'Ostatnie 7 dni',
    last30Days: 'Ostatnie 30 dni',
    totalTokens: 'Łącznie tokenów',
    totalCost: 'Całkowity koszt',
    tokens: 'Tokeny',
    cost: 'Koszt',
    usageOverTime: 'Użycie w czasie',
    byModel: 'Według modelu',
    noData: 'Brak danych o użyciu',
  },

  dev: {
    appInformation: 'Informacje o aplikacji',
    version: 'Wersja',
    buildNumber: 'Numer kompilacji',
    runtimeVersion: 'Wersja runtime',
    packageSource: 'Źródło pakietu',
    buildTime: 'Data kompilacji',
    sdkVersion: 'Wersja SDK',
    platform: 'Platforma',
    anonymousId: 'Anonimowe ID',
    notAvailable: 'Niedostępne',
    debugOptions: 'Opcje debugowania',
    showDebugIds: 'Pokaż ID debugowania',
    showDebugIdsSubtitle: 'Pokaż ID sesji, ID agenta i surowy JSON w informacjach o sesji',
    componentDemos: 'Dema komponentów',
    deviceInfo: 'Informacje o urządzeniu',
    deviceInfoSubtitle: 'Marginesy bezpiecznego obszaru i parametry urządzenia',
    listComponents: 'Komponenty listy',
    listComponentsSubtitle: 'Demo Item, ItemGroup i ItemList',
    typography: 'Typografia',
    typographySubtitle: 'Wszystkie style typograficzne',
    colors: 'Kolory',
    colorsSubtitle: 'Paleta kolorów i motywy',
    messageDemos: 'Dema wiadomości',
    messageDemosSubtitle: 'Różne typy wiadomości i komponentów',
    invertedListTest: 'Test odwróconej listy',
    invertedListTestSubtitle: 'Test odwróconej FlatList z klawiaturą',
    toolViews: 'Widoki narzędzi',
    toolViewsSubtitle: 'Komponenty wizualizacji wywołań narzędzi',
    shimmerView: 'Widok shimmer',
    shimmerViewSubtitle: 'Efekty ładowania shimmer z maskami',
    multiTextInput: 'Wieloliniowe pole tekstowe',
    multiTextInputSubtitle: 'Automatycznie rosnące wieloliniowe pole tekstowe',
    inputStyles: 'Style pól wejściowych',
    inputStylesSubtitle: '10+ wariantów stylów pól wejściowych',
    modalSystem: 'System modali',
    modalSystemSubtitle: 'Alerty, potwierdzenia i niestandardowe modale',
    unitTests: 'Testy jednostkowe',
    unitTestsSubtitle: 'Uruchom testy w środowisku aplikacji',
    unistylesDemo: 'Demo Unistyles',
    unistylesDemoSubtitle: 'Funkcje i możliwości React Native Unistyles',
    qrCodeTest: 'Test kodu QR',
    qrCodeTestSubtitle: 'Testuj generowanie kodów QR z różnymi parametrami',
    testFeatures: 'Funkcje testowe',
    testFeaturesFooter: 'Te akcje mogą wpłynąć na stabilność aplikacji',
    claudeOAuthTest: 'Test OAuth Claude',
    claudeOAuthTestSubtitle: 'Testuj przepływ uwierzytelniania Claude',
    testCrash: 'Test awarii',
    testCrashSubtitle: 'Wywołaj awarię testową',
    testCrashConfirmTitle: 'Test awarii',
    testCrashConfirmMessage: 'Spowoduje to awarię aplikacji. Kontynuować?',
    crash: 'Awaria',
    clearCache: 'Wyczyść pamięć podręczną',
    clearCacheSubtitle: 'Usuń wszystkie dane z pamięci podręcznej',
    clearCacheConfirmTitle: 'Wyczyść pamięć podręczną',
    clearCacheConfirmMessage: 'Czy na pewno chcesz wyczyścić pamięć podręczną? Wiadomości zostaną ponownie pobrane z serwera.',
    clear: 'Wyczyść',
    cacheCleared: 'Pamięć podręczna wyczyszczona',
    failedToClearCache: ({ error }: { error: string }) => `Nie udało się wyczyścić pamięci: ${error}`,
    resetChangelog: 'Resetuj dziennik zmian',
    resetChangelogSubtitle: 'Pokaż ponownie baner „Co nowego"',
    changelogReset: 'Dziennik zmian zresetowany. Uruchom ponownie aplikację, aby zobaczyć baner.',
    resetAppState: 'Resetuj stan aplikacji',
    resetAppStateSubtitle: 'Wyczyść wszystkie dane i preferencje użytkownika',
    resetApp: 'Resetuj aplikację',
    resetAppConfirmMessage: 'Spowoduje to usunięcie wszystkich danych. Czy na pewno?',
    system: 'System',
    purchases: 'Zakupy',
    purchasesSubtitle: 'Wyświetl subskrypcje i uprawnienia',
    expoConstants: 'Stałe Expo',
    expoConstantsSubtitle: 'Wyświetl expoConfig, manifesty i stałe systemowe',
    network: 'Sieć',
    apiEndpoint: 'Endpoint API',
    socketIoStatus: 'Status Socket.IO',
    editApiEndpoint: 'Edytuj endpoint API',
    enterServerUrl: 'Wprowadź URL serwera:',
    serverUrlUpdated: 'URL serwera zaktualizowany. Uruchom ponownie aplikację, aby zmiany zaczęły obowiązywać.',
    invalidUrl: 'Nieprawidłowy URL',
    invalidUrlDefault: 'Wprowadź prawidłowy URL',
    justNow: 'Właśnie teraz',
    secondsAgo: ({ seconds }: { seconds: number }) => `${seconds}s temu`,
    minutesAgo: ({ minutes }: { minutes: number }) => `${minutes}m temu`,
    hoursAgo: ({ hours }: { hours: number }) => `${hours}h temu`,
    daysAgo: ({ days }: { days: number }) => `${days}d temu`,
    connectedAgo: ({ time }: { time: string }) => `Połączono ${time}`,
    lastConnectedAgo: ({ time }: { time: string }) => `Ostatnie połączenie ${time}`,
    connectingToServer: 'Łączenie z serwerem...',
    noConnectionInfo: 'Brak informacji o połączeniu',
    done: 'Gotowe',
  },

  feed: {
    // Feed notifications for friend requests and acceptances
    friendRequestFrom: ({ name }: { name: string }) => `${name} wysłał Ci zaproszenie do znajomych`,
    friendRequestGeneric: 'Nowe zaproszenie do znajomych',
    friendAccepted: ({ name }: { name: string }) => `Jesteś teraz znajomym z ${name}`,
    friendAcceptedGeneric: 'Zaproszenie do znajomych zaakceptowane',
  },

  voiceStatusBar: {
    connecting: 'Łączenie...',
    reconnecting: 'Ponowne łączenie...',
    active: 'Asystent głosowy aktywny',
    error: 'Błąd połączenia',
    default: 'Asystent głosowy',
    tapToEnd: 'Dotknij, aby zakończyć',
  },
} as const;

export type TranslationsPl = typeof pl;
