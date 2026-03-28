export type MockExternalAgentType = 'claude' | 'codex' | 'opencode';

export type MockExternalSession = {
  id: string;
  agentType: MockExternalAgentType;
  title: string;
  cwd: string;
  updatedAt: string;
  imported?: boolean;
};

export const MOCK_EXTERNAL_SESSIONS: MockExternalSession[] = [
  {
    id: 'claude-ext-1',
    agentType: 'claude',
    title: '排查线上权限弹窗重复出现',
    cwd: '/Users/dev/agentbridge',
    updatedAt: '12 min ago',
  },
  {
    id: 'claude-ext-2',
    agentType: 'claude',
    title: '整理 daemon crash 恢复策略',
    cwd: '/Users/dev/agentbridge',
    updatedAt: 'Yesterday',
  },
  {
    id: 'claude-ext-3',
    agentType: 'claude',
    title: '我想让你随便说些啥 并且在说话的过程中 穿插一些工具调度',
    cwd: '/Users/dev/agentbridge',
    updatedAt: '2 days ago',
  },
  {
    id: 'codex-ext-1',
    agentType: 'codex',
    title: '把 tool card turn 后自动关闭',
    cwd: '/Users/dev/agentbridge',
    updatedAt: '1 h ago',
  },
  {
    id: 'codex-ext-2',
    agentType: 'codex',
    title: '查一下最近的 KV 接口 怎么一直在刷 很不符合预期',
    cwd: '/Users/dev/agentbridge',
    updatedAt: '3 h ago',
    imported: true,
  },
  {
    id: 'codex-ext-3',
    agentType: 'codex',
    title: '排查下线上问题',
    cwd: '/Users/dev/agentbridge',
    updatedAt: '1 day ago',
  },
  {
    id: 'opencode-ext-1',
    agentType: 'opencode',
    title: '理解 opencli 功能',
    cwd: '/Users/dev/07',
    updatedAt: '2 days ago',
  },
  {
    id: 'opencode-ext-2',
    agentType: 'opencode',
    title: '深度理解当前项目',
    cwd: '/Users/dev/loom',
    updatedAt: '4 days ago',
  },
];

export function getMockExternalAgentCounts() {
  return MOCK_EXTERNAL_SESSIONS.reduce(
    (acc, session) => {
      acc.total += 1;
      acc[session.agentType] += 1;
      if (session.imported) acc.imported += 1;
      return acc;
    },
    {
      total: 0,
      imported: 0,
      claude: 0,
      codex: 0,
      opencode: 0,
    }
  );
}
