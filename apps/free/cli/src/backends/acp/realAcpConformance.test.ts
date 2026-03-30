import { describe, expect, it } from 'vitest';
import fixture from './fixtures/acpRealCapabilities.json';
import {
  ACP_AGENT_TYPES,
  getAgentModeForPermission,
  getAgentModeMappingsForTest,
  getPermissionModeForAgentMode,
} from './permissionModeMapping';

type RealFixture = {
  agents: Record<
    string,
    {
      currentModeId: string | null;
      modeIds: string[];
      authMethodIds: string[];
    }
  >;
};

const realFixture = fixture as RealFixture;

describe('real ACP conformance', () => {
  it('has real sampled data for every integrated ACP agent', () => {
    expect(Object.keys(realFixture.agents).sort()).toEqual([...ACP_AGENT_TYPES].sort());
  });

  it('only maps forward to real mode ids observed from live ACP sessions', () => {
    const mappings = getAgentModeMappingsForTest();

    for (const agentType of ACP_AGENT_TYPES) {
      const realModeIds = new Set(realFixture.agents[agentType].modeIds);
      for (const permissionMode of ['read-only', 'accept-edits', 'yolo'] as const) {
        const mapped = getAgentModeForPermission(
          agentType,
          permissionMode,
          realFixture.agents[agentType].modeIds
        );

        if (mapped !== null) {
          expect(
            realModeIds.has(mapped),
            `${agentType} ${permissionMode} -> ${mapped} is not present in real ACP data`
          ).toBe(true);
        }

        const declared = mappings[agentType].forward[permissionMode];
        if (declared) {
          expect(
            realModeIds.has(declared),
            `${agentType} declared forward mapping ${permissionMode} -> ${declared} is not present in real ACP data`
          ).toBe(true);
        }
      }
    }
  });

  it('only projects reverse mappings for real mode ids observed from live ACP sessions', () => {
    const mappings = getAgentModeMappingsForTest();

    for (const agentType of ACP_AGENT_TYPES) {
      const realModeIds = new Set(realFixture.agents[agentType].modeIds);

      for (const modeId of Object.keys(mappings[agentType].reverse)) {
        expect(
          realModeIds.has(modeId),
          `${agentType} reverse mapping references unknown real ACP mode ${modeId}`
        ).toBe(true);
      }

      for (const modeId of realFixture.agents[agentType].modeIds) {
        const projected = getPermissionModeForAgentMode(agentType, modeId);
        if (projected !== null) {
          expect(['read-only', 'accept-edits', 'yolo']).toContain(projected);
        }
      }
    }
  });
});
