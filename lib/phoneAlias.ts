// The alias this phone gives itself in its identity bundle (machines pair it
// under that name: `comms pair --stdin --alias <alias>`). Set during first
// launch; installs from before then keep "phone".
import { usePersisted } from "./usePersisted";

export const PHONE_ALIAS_KEY = "phone.alias.v1";
export const DEFAULT_NEW_ALIAS = "joao-phone";

export function usePhoneAlias(): [string, (v: string) => void] {
  return usePersisted<string>(PHONE_ALIAS_KEY, "phone");
}
