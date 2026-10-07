// React Native bindings for the comms core: secure RNG, AsyncStorage KV,
// expo-secure-store for the private key and broker service key.
import nacl from "tweetnacl";
import * as ExpoCrypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KV, SecretStore } from "./storage";

let prngInstalled = false;
/** tweetnacl has no RNG on Hermes; feed it from the platform CSPRNG. */
export function installPRNG(): void {
  if (prngInstalled) return;
  nacl.setPRNG((x: Uint8Array, n: number) => {
    const b = ExpoCrypto.getRandomBytes(n);
    for (let i = 0; i < n; i++) x[i] = b[i];
  });
  prngInstalled = true;
}

export const asyncKV: KV = {
  getItem: (k) => AsyncStorage.getItem(k),
  setItem: (k, v) => AsyncStorage.setItem(k, v),
  removeItem: (k) => AsyncStorage.removeItem(k),
};

export const secureSecrets: SecretStore = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  remove: (k) => SecureStore.deleteItemAsync(k),
};
