import * as Localization from 'expo-localization';
import {
  type SupportedLanguage,
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  DEFAULT_LANGUAGE,
} from './_all';
import { en, type Translations, type TranslationStructure } from './_default';
import { ca } from './translations/ca';
import { es } from './translations/es';
import { it } from './translations/it';
import { ja } from './translations/ja';
import { pl } from './translations/pl';
import { pt } from './translations/pt';
import { ru } from './translations/ru';
import { zhHans } from './translations/zh-Hans';
import { zhHant } from './translations/zh-Hant';
import { loadSettings } from '@/sync/persistence';
import { Logger, toError } from '@saaskit-dev/agentbridge/telemetry';
const logger = new Logger('app/text');

/**
 * Extract all possible dot-notation keys from the nested translation object
 * E.g., 'common.cancel', 'settings.title', 'time.minutesAgo'
 */
type NestedKeys<T, Path extends string = ''> = T extends object
  ? {
      [K in keyof T]: K extends string
        ? T[K] extends string | ((...args: any[]) => string)
          ? Path extends ''
            ? K
            : `${Path}.${K}`
          : NestedKeys<T[K], Path extends '' ? K : `${Path}.${K}`>
        : never;
    }[keyof T]
  : never;

/**
 * Get the value type at a specific dot-notation path
 */
type GetValue<T, Path> = Path extends `${infer Key}.${infer Rest}`
  ? Key extends keyof T
    ? GetValue<T[Key], Rest>
    : never
  : Path extends keyof T
    ? T[Path]
    : never;

/**
 * Extract parameter type from a translation value
 * - If it's a function: extract the first parameter type
 * - If it's a string: return void (no parameters needed)
 */
type GetParams<V> = V extends (params: infer P) => string ? P : V extends string ? void : never;

/**
 * All valid translation keys
 */
export type TranslationKey = NestedKeys<Translations>;

/**
 * Get the parameter type for a specific translation key
 */
export type TranslationParams<K extends TranslationKey> = GetParams<GetValue<Translations, K>>;

/**
 * Re-export language types and configuration
 */
export type { SupportedLanguage } from './_all';
export {
  SUPPORTED_LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
  DEFAULT_LANGUAGE,
  getLanguageNativeName,
  getLanguageEnglishName,
} from './_all';

/**
 * Translation objects for all supported languages
 * Each language must match the exact structure of the English translations
 * All languages defined in SUPPORTED_LANGUAGES must be imported and included here
 */
const rawTranslations: Record<SupportedLanguage, TranslationStructure> = {
  en,
  ru,
  pl,
  es,
  it,
  pt,
  ca,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
  ja,
};

function mergeTranslations<T extends Record<string, any>>(base: T, overrides?: TranslationStructure<T>): T {
  if (!overrides) {
    return base;
  }

  const result: Record<string, any> = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(overrides) as Array<keyof T>) {
    const overrideValue = overrides[key];
    if (overrideValue === undefined) {
      continue;
    }

    const baseValue = base[key];
    if (
      baseValue &&
      overrideValue &&
      typeof baseValue === 'object' &&
      typeof overrideValue === 'object' &&
      !Array.isArray(baseValue) &&
      !Array.isArray(overrideValue)
    ) {
      result[key as string] = mergeTranslations(baseValue, overrideValue as TranslationStructure<typeof baseValue>);
      continue;
    }

    result[key as string] = overrideValue;
  }

  return result as T;
}

const translations: Record<SupportedLanguage, Translations> = {
  en,
  ru: mergeTranslations(en, ru),
  pl: mergeTranslations(en, pl),
  es: mergeTranslations(en, es),
  it: mergeTranslations(en, it),
  pt: mergeTranslations(en, pt),
  ca: mergeTranslations(en, ca),
  'zh-Hans': mergeTranslations(en, zhHans),
  'zh-Hant': mergeTranslations(en, zhHant),
  ja: mergeTranslations(en, ja),
};

// Compile-time check: ensure all supported languages have translations
const _typeCheck: Record<SupportedLanguage, TranslationStructure> = rawTranslations;

//
// Resolve language
//

let currentLanguage: SupportedLanguage = DEFAULT_LANGUAGE;

/**
 * Resolve language from a preferred language setting + device locales.
 * Used both at startup and when the setting changes at runtime.
 */
export function resolveLanguage(preferredLanguage: string | null | undefined): SupportedLanguage {
  if (preferredLanguage && preferredLanguage in translations) {
    logger.debug(`[i18n] Using preferred language: ${preferredLanguage}`);
    return preferredLanguage as SupportedLanguage;
  }

  const locales = Localization.getLocales();
  for (const l of locales) {
    if (l.languageCode) {
      if (l.languageCode === 'zh') {
        if (l.languageScriptCode === 'Hans' && 'zh-Hans' in translations) return 'zh-Hans';
        if (l.languageScriptCode === 'Hant' && 'zh-Hant' in translations) return 'zh-Hant';
        return 'zh-Hans';
      }
      if (l.languageCode in translations) return l.languageCode as SupportedLanguage;
    }
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Update the active language at runtime.
 * Call this after KV stores are initialized or when the user changes the language setting.
 */
export function setLanguage(lang: SupportedLanguage): void {
  currentLanguage = lang;
  logger.debug(`[i18n] Language set to: ${lang}`);
}

// Initial resolution using device locale only (settings KV store not ready yet at import time)
currentLanguage = resolveLanguage(null);
logger.debug(`[i18n] Initial language (device locale): ${currentLanguage}`);

/**
 * Main translation function with strict typing
 *
 * @param key - Dot-notation key for the translation (e.g., 'common.cancel', 'time.minutesAgo')
 * @param params - Object parameters required by the translation function (if any)
 * @returns Translated string
 *
 * @example
 * // Simple constants (no parameters)
 * t('common.cancel')                    // "Cancel" or "Отмена"
 * t('settings.title')                   // "Settings" or "Настройки"
 *
 * // Functions with required object parameters
 * t('common.welcome', { name: 'Steve' })           // "Welcome, Steve!" or "Добро пожаловать, Steve!"
 * t('errors.fieldError', { field: 'Email', reason: 'Invalid' })
 *
 * // Complex parameters
 * t('sessionInfo.agentState')           // "Agent State" or "Состояние агента"
 */
export function t<K extends TranslationKey>(
  key: K,
  ...args: GetParams<GetValue<Translations, K>> extends void
    ? []
    : [GetParams<GetValue<Translations, K>>]
): string {
  try {
    // Get current language translations
    const currentTranslations = translations[currentLanguage];

    // Navigate to the value using dot notation
    const keys = key.split('.');
    let value: any = currentTranslations;

    for (const k of keys) {
      value = value[k];
      if (value === undefined) {
        logger.warn(`Translation missing: ${key}`);
        return key;
      }
    }

    // If it's a function, call it with the provided parameters
    if (typeof value === 'function') {
      const params = args[0];
      return value(params);
    }

    // If it's a string constant, return it directly
    if (typeof value === 'string') {
      return value;
    }

    // Fallback for unexpected types
    logger.warn(`Invalid translation value type for key: ${key}`);
    return key;
  } catch (error) {
    logger.error(`Translation error for key: ${key}`, toError(error));
    return key;
  }
}

/**
 * Get the currently active language
 * Useful for debugging and language-aware components
 */
export function getCurrentLanguage(): SupportedLanguage {
  return currentLanguage;
}
