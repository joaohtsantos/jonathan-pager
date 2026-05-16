import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setupChannels, registerForPush } from "./pushSetup";

interface TokenContextValue {
  token: string | null;
  error: string | null;
}

const TokenContext = createContext<TokenContextValue>({ token: null, error: null });

export function useToken(): TokenContextValue {
  return useContext(TokenContext);
}

export function TokenProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setupChannels();
    registerForPush()
      .then(setToken)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <TokenContext.Provider value={{ token, error }}>{children}</TokenContext.Provider>
  );
}
