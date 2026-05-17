// API_BASE_URL and API_KEY come from env at bundle time.
// Local dev: set in `.env.local` (gitignored).
// EAS builds: set via `eas secret:create --scope project --name EXPO_PUBLIC_API_KEY ...`.
// EXPO_PUBLIC_-prefixed vars are inlined by Metro into the JS bundle.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
export const API_KEY = process.env.EXPO_PUBLIC_API_KEY ?? "";
