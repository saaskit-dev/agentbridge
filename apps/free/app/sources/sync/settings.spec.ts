import { describe, it, expect } from 'vitest';
import {
  settingsParse,
  applySettings,
  settingsDefaults,
  SUPPORTED_SCHEMA_VERSION,
} from './settings';

describe('settingsParse', () => {
  it('returns defaults for null input', () => {
    const result = settingsParse(null);
    expect(result).toEqual({ ...settingsDefaults });
  });

  it('returns defaults for undefined input', () => {
    const result = settingsParse(undefined);
    expect(result).toEqual({ ...settingsDefaults });
  });

  it('returns defaults for non-object input', () => {
    expect(settingsParse('string')).toEqual({ ...settingsDefaults });
    expect(settingsParse(42)).toEqual({ ...settingsDefaults });
    expect(settingsParse(true)).toEqual({ ...settingsDefaults });
  });

  it('returns defaults for empty object', () => {
    const result = settingsParse({});
    expect(result).toEqual({ ...settingsDefaults });
  });

  it('merges partial settings with defaults', () => {
    const result = settingsParse({ viewInline: false, experiments: false });
    expect(result.viewInline).toBe(false);
    expect(result.experiments).toBe(false);
    // Other fields get defaults
    expect(result.showLineNumbers).toBe(settingsDefaults.showLineNumbers);
    expect(result.schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);
  });

  it('preserves unknown fields for forward compatibility', () => {
    const result = settingsParse({ futureFeature: 'hello', viewInline: false });
    expect((result as any).futureFeature).toBe('hello');
    expect(result.viewInline).toBe(false);
  });

  it('migrates "zh" language code to "zh-Hans"', () => {
    const result = settingsParse({ preferredLanguage: 'zh' });
    expect(result.preferredLanguage).toBe('zh-Hans');
  });

  it('does not migrate valid language codes', () => {
    const result = settingsParse({ preferredLanguage: 'en' });
    expect(result.preferredLanguage).toBe('en');
  });

  it('migrates legacy permission modes in lastUsedPermissionMode', () => {
    const result = settingsParse({ lastUsedPermissionMode: 'acceptEdits' });
    expect(result.lastUsedPermissionMode).toBe('accept-edits');
  });

  it('clears unknown legacy permission mode in lastUsedPermissionMode', () => {
    const result = settingsParse({ lastUsedPermissionMode: 'unknownMode' });
    expect(result.lastUsedPermissionMode).toBeNull();
  });

  it('handles dismissedCLIWarnings with defaults', () => {
    const result = settingsParse({});
    expect(result.dismissedCLIWarnings).toEqual({ perMachine: {}, global: {} });
  });

  it('handles recentMachinePaths default', () => {
    const result = settingsParse({});
    expect(result.recentMachinePaths).toEqual([]);
  });

  it('preserves valid recentMachinePaths', () => {
    const paths = [{ machineId: 'm1', path: '/foo' }];
    const result = settingsParse({ recentMachinePaths: paths });
    expect(result.recentMachinePaths).toEqual(paths);
  });

  it('handles invalid zod parse by preserving unknown fields with defaults', () => {
    // Pass something that would fail zod parsing (e.g., wrong type for a known field)
    const result = settingsParse({ viewInline: 'not-a-boolean', unknownKey: 123 });
    // Zod partial parse is lenient — invalid fields get stripped, defaults fill in
    expect(result.unknownKey).toBe(123);
    expect(typeof result.viewInline).toBe('boolean');
  });
});

describe('applySettings', () => {
  it('applies delta to settings', () => {
    const base = { ...settingsDefaults };
    const result = applySettings(base, { viewInline: false });
    expect(result.viewInline).toBe(false);
    // Other fields unchanged
    expect(result.experiments).toBe(settingsDefaults.experiments);
  });

  it('does not mutate the original settings', () => {
    const base = { ...settingsDefaults };
    const original = { ...base };
    applySettings(base, { viewInline: false });
    expect(base).toEqual(original);
  });

  it('fills in missing fields with defaults', () => {
    const partial = { viewInline: true } as any;
    const result = applySettings(partial, {});
    expect(result.schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION);
    expect(result.showLineNumbers).toBe(settingsDefaults.showLineNumbers);
  });

  it('delta overrides existing values', () => {
    const base = { ...settingsDefaults, preferredLanguage: 'en' };
    const result = applySettings(base, { preferredLanguage: 'ja' });
    expect(result.preferredLanguage).toBe('ja');
  });

  it('handles empty delta', () => {
    const base = { ...settingsDefaults };
    const result = applySettings(base, {});
    expect(result).toEqual(base);
  });

  it('can set nullable fields to null', () => {
    const base = { ...settingsDefaults, inferenceOpenAIKey: 'sk-123' };
    const result = applySettings(base, { inferenceOpenAIKey: null });
    expect(result.inferenceOpenAIKey).toBeNull();
  });
});
