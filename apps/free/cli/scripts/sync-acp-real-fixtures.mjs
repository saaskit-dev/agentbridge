import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_INPUT = '/tmp/acp_probe_results.json';
const DEFAULT_OUTPUT = resolve(
  process.cwd(),
  'src/backends/acp/fixtures/acpRealCapabilities.json'
);

function normalizeFromProbe(raw) {
  const agents = {};

  for (const [agentId, value] of Object.entries(raw)) {
    if (!value || value.ok !== true || !value.session) {
      continue;
    }

    agents[agentId] = {
      currentModeId: value.session.currentModeId ?? null,
      modeIds: (value.session.availableModes ?? []).map(mode => mode.id),
      authMethodIds: (value.init?.authMethods ?? []).map(method => method.id ?? method.name),
    };
  }

  return {
    source: 'acp-probe',
    generatedAt: new Date().toISOString(),
    agents,
  };
}

function normalizeFromMatrix(raw) {
  return {
    source: 'acp-sdk-matrix',
    generatedAt: raw.generatedAt ?? new Date().toISOString(),
    agents: Object.fromEntries(
      Object.entries(raw.agents ?? {}).map(([agentId, value]) => [
        agentId,
        {
          currentModeId: value.currentModeId ?? null,
          modeIds: (value.modes ?? []).map(mode => mode.id),
          authMethodIds: (value.authMethods ?? []).map(method => method.id ?? method.name),
        },
      ])
    ),
  };
}

function normalize(raw) {
  if (raw && typeof raw === 'object' && 'agents' in raw) {
    return normalizeFromMatrix(raw);
  }
  return normalizeFromProbe(raw);
}

function mergeNormalizedFixtures(fixtures) {
  return fixtures.reduce(
    (merged, fixture, index) => ({
      source:
        index === 0 ? fixture.source : `${merged.source}+${fixture.source}`,
      generatedAt: fixture.generatedAt ?? merged.generatedAt,
      agents: {
        ...merged.agents,
        ...fixture.agents,
      },
    }),
    {
      source: 'unknown',
      generatedAt: new Date().toISOString(),
      agents: {},
    }
  );
}

const cliArgs = process.argv.slice(2);
const outputFlagIndex = cliArgs.indexOf('--output');
const outputPath =
  outputFlagIndex >= 0 && cliArgs[outputFlagIndex + 1]
    ? resolve(cliArgs[outputFlagIndex + 1])
    : DEFAULT_OUTPUT;

const inputArgs =
  outputFlagIndex >= 0
    ? cliArgs.filter((_, index) => index !== outputFlagIndex && index !== outputFlagIndex + 1)
    : cliArgs;

const inputPaths = inputArgs.length > 0 ? inputArgs.map(input => resolve(input)) : [DEFAULT_INPUT];

const normalized = mergeNormalizedFixtures(
  inputPaths.map(inputPath => normalize(JSON.parse(readFileSync(inputPath, 'utf8'))))
);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');

console.log(`Wrote ACP real fixture to ${outputPath} from ${inputPaths.join(', ')}`);
