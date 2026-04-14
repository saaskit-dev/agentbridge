import { compareCreatedDesc } from '@/sync/entitySort';
import type { Machine, Session } from '@/sync/storageTypes';
import { getSessionAvatarId, getSessionName } from '@/utils/sessionUtils';

export type ProjectSessionRow = {
  session: Session;
  sessionName: string;
  avatarId: string;
};

export type ProjectSessionMachineGroup = {
  machineId: string;
  machine: Machine | null;
  machineName: string;
  sessions: ProjectSessionRow[];
};

export type ProjectSessionGroup = {
  path: string;
  displayPath: string;
  firstSession: Session | null;
  firstSessionAvatarId: string | null;
  machineLabel: string;
  machineGroups: ProjectSessionMachineGroup[];
};

type BuildProjectSessionGroupsOptions = {
  unknownMachineId: string;
  unknownMachineDisplayName: string;
};

function formatPathRelativeToHome(path: string, homeDir?: string): string {
  if (!homeDir) return path;

  const normalizedHome = homeDir.endsWith('/') ? homeDir.slice(0, -1) : homeDir;
  if (!path.startsWith(normalizedHome)) {
    return path;
  }

  const relativePath = path.slice(normalizedHome.length);
  if (relativePath.startsWith('/')) {
    return `~${relativePath}`;
  }
  if (relativePath === '') {
    return '~';
  }
  return `~/${relativePath}`;
}

export function buildProjectSessionGroups(
  sessions: Session[],
  machines: Machine[],
  options: BuildProjectSessionGroupsOptions
): ProjectSessionGroup[] {
  const machinesById: Record<string, Machine> = {};
  for (const machine of machines) {
    machinesById[machine.id] = machine;
  }

  const groups = new Map<
    string,
    {
      path: string;
      displayPath: string;
      firstSession: Session | null;
      firstMachineName: string | null;
      machineGroups: Map<string, ProjectSessionMachineGroup>;
    }
  >();

  for (const session of sessions) {
    const projectPath = session.metadata?.path || '';
    const machineId = session.metadata?.machineId || options.unknownMachineId;
    const machine = machineId !== options.unknownMachineId ? machinesById[machineId] ?? null : null;
    const machineName =
      machine?.metadata?.displayName ||
      machine?.metadata?.host ||
      (machineId !== options.unknownMachineId ? machineId : options.unknownMachineDisplayName);

    let projectGroup = groups.get(projectPath);
    if (!projectGroup) {
      projectGroup = {
        path: projectPath,
        displayPath: formatPathRelativeToHome(projectPath, session.metadata?.homeDir),
        firstSession: null,
        firstMachineName: null,
        machineGroups: new Map(),
      };
      groups.set(projectPath, projectGroup);
    }

    if (!projectGroup.firstSession) {
      projectGroup.firstSession = session;
      projectGroup.firstMachineName = machineName;
    }

    let machineGroup = projectGroup.machineGroups.get(machineId);
    if (!machineGroup) {
      machineGroup = {
        machineId,
        machine,
        machineName,
        sessions: [],
      };
      projectGroup.machineGroups.set(machineId, machineGroup);
    }

    machineGroup.sessions.push({
      session,
      sessionName: getSessionName(session),
      avatarId: getSessionAvatarId(session),
    });
  }

  return Array.from(groups.values())
    .map(projectGroup => {
      const machineGroups = Array.from(projectGroup.machineGroups.values())
        .map(machineGroup => ({
          ...machineGroup,
          sessions: [...machineGroup.sessions].sort((left, right) =>
            compareCreatedDesc(left.session, right.session)
          ),
        }))
        .sort((left, right) => left.machineName.localeCompare(right.machineName));

      return {
        path: projectGroup.path,
        displayPath: projectGroup.displayPath,
        firstSession: projectGroup.firstSession,
        firstSessionAvatarId: projectGroup.firstSession
          ? getSessionAvatarId(projectGroup.firstSession)
          : null,
        machineLabel:
          machineGroups.length === 1
            ? (projectGroup.firstMachineName ?? machineGroups[0]?.machineName ?? '')
            : `${machineGroups.length} machines`,
        machineGroups,
      } satisfies ProjectSessionGroup;
    })
    .sort((left, right) => left.displayPath.localeCompare(right.displayPath));
}
