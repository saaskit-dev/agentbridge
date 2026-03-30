import { describe, expect, it } from 'vitest';
import capabilityFixture from './fixtures/acpRealCapabilities.json';
import permissionFixture from './fixtures/acpRealPermissionObservations.json';
import { ACP_AGENT_TYPES } from './permissionModeMapping';

type CapabilityFixture = {
  agents: Record<string, { modeIds: string[] }>;
};

type PermissionObservationFixture = {
  agents: Record<
    string,
    | {
        status: 'permission_request_observed';
        attemptedModeId: string;
        attemptedPrompt: string;
        options: Array<{ optionId: string; name: string; kind: string }>;
      }
    | {
        status: 'sampling_blocked' | 'no_permission_request_observed';
        reason?: string;
        attemptedModeId?: string;
        attemptedPrompt?: string;
        notes?: string[];
      }
  >;
};

const realCapabilities = capabilityFixture as CapabilityFixture;
const realPermissionObservations = permissionFixture as PermissionObservationFixture;

describe('real ACP permission observations', () => {
  it('tracks a real permission observation status for every integrated ACP agent', () => {
    expect(Object.keys(realPermissionObservations.agents).sort()).toEqual([...ACP_AGENT_TYPES].sort());
  });

  it('only references real sampled mode ids when an attempted mode is recorded', () => {
    for (const agentType of ACP_AGENT_TYPES) {
      const observation = realPermissionObservations.agents[agentType];
      const modeIds = new Set(realCapabilities.agents[agentType].modeIds);

      if ('attemptedModeId' in observation && observation.attemptedModeId) {
        expect(
          modeIds.has(observation.attemptedModeId),
          `${agentType} attempted permission sampling with unknown mode ${observation.attemptedModeId}`
        ).toBe(true);
      }
    }
  });

  it('records ACP-standard permission option kinds when a request was observed', () => {
    for (const agentType of ACP_AGENT_TYPES) {
      const observation = realPermissionObservations.agents[agentType];
      if (observation.status !== 'permission_request_observed') {
        continue;
      }

      expect(observation.options.length).toBeGreaterThan(0);
      for (const option of observation.options) {
        expect(['allow_once', 'allow_always', 'reject_once', 'reject_always']).toContain(option.kind);
      }
    }
  });
});
