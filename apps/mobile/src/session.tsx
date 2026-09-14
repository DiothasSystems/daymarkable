/**
 * The session, in the keychain and in React.
 *
 * What is stored is the same opaque `sessions.id` a browser keeps in its cookie — see
 * `apps/web/src/server/device-login.ts` for how the phone comes by one without a deep link. It
 * goes in expo-secure-store (Keychain on iOS, EncryptedSharedPreferences on Android) rather than
 * AsyncStorage, because it is a credential.
 */
import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const KEY = "dm.session";

export async function readStoredSession(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    // A keychain that will not open is a signed-out app, not a crashed one.
    return null;
  }
}

export async function storeSession(id: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, id, { keychainAccessible: SecureStore.WHEN_UNLOCKED });
}

export async function clearStoredSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Already gone.
  }
}

interface SessionState {
  /** Null once loaded and signed out; undefined while the keychain is still being read. */
  session: string | null | undefined;
  signIn(id: string): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void readStoredSession().then(setSession);
  }, []);

  const signIn = useCallback(async (id: string) => {
    await storeSession(id);
    setSession(id);
  }, []);

  const signOut = useCallback(async () => {
    await clearStoredSession();
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
