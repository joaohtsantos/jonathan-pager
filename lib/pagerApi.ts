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
  payload?: string | null;
}

export interface RequestAction {
  label: string;
  url: string;
}

/** Generic (non-email) request types: no draft, Done/Dismiss labels. */
export const GENERIC_REQUEST_TYPES = new Set(["action_card", "mark_read"]);

/** payload is a JSON string column returned raw. Only https action URLs are
 * honored — the app is the last line of defense before Linking.openURL. */
export function parseRequestPayload(raw: unknown): { detail?: string; actions: RequestAction[] } {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = null;
    }
  }
  if (!obj || typeof obj !== "object") return { actions: [] };
  const o = obj as { detail?: unknown; actions?: unknown };
  const actions = Array.isArray(o.actions)
    ? (o.actions as unknown[]).filter(
        (a): a is RequestAction =>
          typeof (a as RequestAction)?.label === "string" && typeof (a as RequestAction)?.url === "string" && /^https:\/\//.test((a as RequestAction).url)
      )
    : [];
  return { detail: typeof o.detail === "string" ? o.detail : undefined, actions };
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

export const fetchPush = (id: string) => get<PagerPush>(`/pushes/${id}`);

/** Approve / reject a request (same call the old Requests screen made): the
 * proposal is sent only on approve, when edited and non-empty. */
export async function answerRequest(req: Pick<PagerRequest, "id" | "proposed_action">, status: "approved" | "rejected", edited?: string): Promise<void> {
  const sendEdit = status === "approved" && typeof edited === "string" && edited.trim().length > 0 && edited !== req.proposed_action;
  const res = await fetch(`${API_BASE_URL}/requests/${req.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(sendEdit ? { status, proposed_action: edited } : { status }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function setPushRead(id: string, read: boolean): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/pushes/${id}`, { method: "PATCH", headers, body: JSON.stringify({ read }) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function markAllPushesRead(): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/pushes/read-all`, { method: "POST", headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
