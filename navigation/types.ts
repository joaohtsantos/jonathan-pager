// Route params for the four tab stacks.
export type AgentsStackParamList = {
  AgentsList: undefined;
  AgentDetail: { machine: string; agent: string };
  Graveyard: undefined;
};

export type InboxStackParamList = {
  InboxList: { machine?: string; agent?: string } | undefined;
  InboxItem: { machine: string; id: string };
  PushDetail: { id: string };
  PushList: undefined;
  Requests: undefined;
};

export type MachinesStackParamList = {
  MachinesList: undefined;
  MachineDetail: { machine: string };
};
