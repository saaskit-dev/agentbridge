import type { SessionCapabilities } from '@/daemon/sessions/capabilities';

export function getDefaultDiscoveredModelId(
  capabilities: SessionCapabilities | null | undefined
): string | null {
  const models = capabilities?.models?.available ?? [];
  if (!models.length) {
    return null;
  }

  if (capabilities?.models?.current && models.some(model => model.id === capabilities.models?.current)) {
    return capabilities.models.current;
  }

  return models[0]?.id ?? null;
}

export function hasDiscoveredModel(
  capabilities: SessionCapabilities | null | undefined,
  modelId: string
): boolean {
  return (capabilities?.models?.available ?? []).some(model => model.id === modelId);
}
