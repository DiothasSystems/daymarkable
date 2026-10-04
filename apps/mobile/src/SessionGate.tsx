/**
 * Leave the signed-in part of the app the moment there is no session.
 *
 * `app/index.tsx` sends people where they belong, but it only decides ONCE: it has already
 * redirected and unmounted by the time anyone is looking at a tab. So clearing the session left
 * every signed-in screen sitting there unchanged — Sign out appeared to do nothing at all, when in
 * truth the credential was gone and the screen was a picture of the last request that worked.
 *
 * The button is not the only way in. `useQuery` signs the app out whenever the server stops
 * honouring a session (useApi.ts), so an expired one stranded people the same way, with the
 * further twist that nothing had been pressed. One guard covers both, and any later way of
 * becoming signed out, which is why this watches the session rather than being a line in the
 * Sign out handler.
 *
 * It renders nothing. It is mounted once, beside the Stack, so it is watching wherever you are.
 */
import { useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { useSession } from "./session";

/** Where a signed-out person is allowed to be. The tour is reachable without an account. */
export const SIGNED_OUT_OK = ["sign-in", "tour"];

export function SessionGate() {
  const { session } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // `undefined` is the keychain still being read, and must not redirect: doing so would bounce
    // every cold start to sign-in before the stored session had arrived.
    if (session !== null) return;
    const top = segments[0];
    // `undefined` is the index route, which decides for itself.
    if (top === undefined || SIGNED_OUT_OK.includes(top)) return;
    router.replace("/sign-in");
  }, [session, segments, router]);

  return null;
}
