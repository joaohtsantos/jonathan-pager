// Route params for the four tab stacks.
import type { PagerPush, PagerRequest } from "../lib/pagerApi";

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
  /** Legacy pager-api item: a pending request (InboxOpenAsk) or a push (InboxOpenMsg). */
  PagerItem: { request: PagerRequest } | { push: PagerPush };
};

export type MachinesStackParamList = {
  MachinesList: undefined;
  MachineDetail: { machine: string };
  Pair: undefined;
  Settings: undefined;
  Notifications: undefined;
};

export type LocationStackParamList = {
  LocationMain: undefined;
  Zones: undefined;
};
