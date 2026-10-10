# jonathan-pager

Expo / React Native mobile app — the frontend of the Pager pair. Receives push notifications, browses inbox, and approves/rejects proposal requests from Jonathan.

## Stack
- Expo SDK 55, React Native 0.83, React 19, TypeScript
- Navigation: `@react-navigation/{native,native-stack,bottom-tabs}`
- Push: `expo-notifications` + Firebase (Android `google-services.json`)
- Storage: `@react-native-async-storage/async-storage`, `expo-secure-store`
- EAS project: `00f38f4e-21a0-43da-b440-20c6a09679a4` (owner: `joaohts`)
- Android package: `cc.jsplayground.pager`

## Run
- `npm start` — Expo dev server
- `npm run android` / `npm run ios` / `npm run web`
- Builds: configured via `eas.json` (Expo Application Services)

## Screens (4 tabs: Agents · Inbox · Location · Machines; designs in `scratchpad/design/project/*.dc.html`)
- `screens/agents/` — machine sections (reorder + float, saved locally), D6 agent detail states, Graveyard
- `screens/inbox/` — InboxK3 list (porter notifies + legacy pager-api pushes), opened message / question (draft reply), Senders
- `screens/location/` — Day/Week/Month/Custom periods, by-place totals, timeline corrections, Zones (zone colors client-side)
- `screens/machines/` — list, machine detail, Add a machine, Settings, Settings › Notifications
- `screens/onboarding/` — first launch (only when no broker configured)
- Legacy, reachable from Inbox: `PushListScreen` (Inbox menu › Pager log), `PushDetailScreen`, `RequestsScreen`
- Styling: tokens in `theme.ts` (`t`), primitives in `components/ui.tsx`
- Dev mock data: Machines › Settings › Developer (dev builds only), `porter/mock.ts`

## Comms / porter (Agent Monitor Mobile)
- `comms/` — TypeScript comms node (port of `~/fun/comms`): identity in expo-secure-store, broker auth, presence for agent `app`, grants, NaCl envelopes, NDJSON stream (XHR), receipts/acks. Tests: `npm test` (Go-produced vectors in `comms/__tests__/vectors`; live interop test needs a scratch Go broker, see `interop.test.ts`).
- `porter/` — porter contract v1 (`~/fun/comms` `docs/PORTER.md`): client, persisted store, encrypted push task (`porter/pushTask.ts`, imported in `index.ts`), local notification channels per kind (`pager-approvals|questions|special|alerts|messages`), approval action buttons answered from the background task (`porter/notify.ts`).
- Status, ledger and design notes: `~/notes/kb/projects/pager-app/` (incl. `pager-agent-monitor.md`).

## Wiring
- **Backend pair:** `~/pager-api/` — `constants.ts` hardcodes:
  - `API_BASE_URL = "https://pager.jsplayground.cc"`
  - `API_KEY` (bearer for pager-api) — **rotate together with pager-api's `.env`**.
- **Push tokens:** Expo push tokens registered on app start, sent to pager-api.
- **Reaches:** all pager-api endpoints listed in `~/pager-api/CLAUDE.md`.

## Gotchas
- `google-services.json` is committed alongside the app and is **environment-specific** — keep it in sync with the Firebase project.
- Bearer key in `constants.ts` ships with the binary — rotating requires a new EAS build.
- iOS push needs APNs configured separately on the EAS side.
- Dark UI (`userInterfaceStyle: "dark"`, splash bg `#000000`) is hardcoded in `app.config.js`.
