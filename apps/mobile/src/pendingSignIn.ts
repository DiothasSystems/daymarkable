/**
 * A sign-in waiting for its emailed link, kept in the keychain rather than only in memory.
 *
 * The link now opens in this app (an App Link on /auth/app). Android may have closed the app while
 * its owner was in their mail, so the screen that receives the link can be a fresh start with no
 * idea a sign-in was under way. Keeping the waiting sign-in's secret here lets it carry on. The
 * secret is worth a session to whoever spends it, which is why it lives in the keychain and dies
 * with its fifteen-minute window.
 */
import * as SecureStore from "expo-secure-store";

const KEY = "scriptumiq.pending-sign-in";

export interface PendingSignIn {
  pollSecret: string;
  deadline: number;
  email: string;
}

export async function savePendingSignIn(p: PendingSignIn): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(p), { keychainAccessible: SecureStore.WHEN_UNLOCKED });
}

/** The waiting sign-in, or null when there is none or its window has closed. */
export async function loadPendingSignIn(): Promise<PendingSignIn | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingSignIn;
    if (!p.pollSecret || !(p.deadline > Date.now())) {
      await clearPendingSignIn();
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export async function clearPendingSignIn(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Nothing stored is the state we wanted.
  }
}
