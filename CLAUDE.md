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

## Screens
- `screens/PushListScreen.tsx` — incoming push notifications
- `screens/PushDetailScreen.tsx` — push detail view
- `screens/RequestsScreen.tsx` — proposal request approve/reject

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
- Dark UI (`userInterfaceStyle: "dark"`, splash bg `#111111`) is hardcoded in `app.config.js`.
