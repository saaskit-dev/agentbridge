export type ModelInfo = {
  id: string;
  name: string;
  description?: string;
};

export type ModeInfo = {
  id: string;
  name: string;
  description?: string;
};

export type ConfigOption = {
  id: string;
  name: string;
  description?: string;
  category: 'mode' | 'model' | 'thought_level' | (string & {});
  type: 'select';
  options: Array<{
    value: string;
    label: string;
  }>;
  currentValue: string;
};

export type AgentCommand = {
  id: string;
  name: string;
  description?: string;
};

export type SessionCapabilities = {
  models?: {
    available: ModelInfo[];
    current: string;
  };
  modes?: {
    available: ModeInfo[];
    current: string;
  };
  configOptions?: ConfigOption[];
  commands?: AgentCommand[];
};
