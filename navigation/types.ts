// Route params for the four tab stacks.
export type AgentDetailParams = { machine: string; agent: string; /** back-link label */ from?: string };

export type AgentsStackParamList = {
  AgentsList: undefined;
  AgentDetail: AgentDetailParams;
  Graveyard: undefined;
};

export type InboxStackParamList = {
  InboxList: { machine?: string; agent?: string } | undefined;
  InboxItem: { machine: string; id: string };
  AgentDetail: AgentDetailParams;
  Senders: undefined;
  PushDetail: { id: string };
  PushList: undefined;
  Requests: undefined;
};

export type MachinesStackParamList = {
  MachinesList: undefined;
  MachineDetail: { machine: string };
  Pair: undefined;
  Settings: undefined;
};
