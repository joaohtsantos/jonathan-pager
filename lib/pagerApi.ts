// pager-api reads used by the merged Inbox (same endpoints the old
// Notifications / Requests tabs call). Kept until the comms switchover is done.
import { API_BASE_URL, API_KEY } from "../constants";

export type PushCategory = "urgent" | "alert" | "info";

export interface PagerPush {
  id: string;
  category: PushCategory;
  title: string;
  body: string | null;
  source: string;
  read: 0 | 1;
  created_at: string;
  read_at: string | null;
}

export interface PagerRequest {
  id: string;
  type: string;
  email_subject: string | null;
  email_sender: string | null;
  summary: string;
  proposed_action: string;
  priority: "low" | "medium" | "high";
  status: string;
  created_at: string;
}

const headers = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const pagerConfigured = () => API_BASE_URL !== "";

export const fetchPushes = (limit = 50) => get<PagerPush[]>(`/pushes?limit=${limit}`);
export const fetchPendingRequests = () => get<PagerRequest[]>(`/requests?status=pending`);

export async function setPushRead(id: string, read: boolean): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/pushes/${id}`, { method: "PATCH", headers, body: JSON.stringify({ read }) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function markAllPushesRead(): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/pushes/read-all`, { method: "POST", headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
