/**
 * Where the emailed sign-in link lands when it is tapped on the phone.
 *
 * A sign-in asked for from this app is mailed a link on /auth/app, and Android opens that link here
 * rather than in the browser (an App Link, verified by the site's /.well-known/assetlinks.json). This
 * screen spends the token exactly as the browser would — by asking for /auth/verify, which is the one
 * place a session is ever created (rule 18) — and the sign-in screen, still waiting, collects the
 * session that request bound to it and signs the app in. Nothing about the token is kept or logged.
 */
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { API_URL } from "@/api";
import { loadPendingSignIn } from "@/pendingSignIn";
import { useSession } from "@/session";
import { color, space, type } from "@/theme";

export default function SignInLink() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  const { session } = useSession();
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (session === undefined) return; // the keychain has not answered yet
    if (session) {
      // Already signed in: the link has nothing left to do here.
      router.replace("/");
      return;
    }
    if (!token) {
      setProblem("That link is incomplete. Sign in again for a new one.");
      return;
    }
    let live = true;
    void (async () => {
      const waiting = await loadPendingSignIn();
      try {
        // Spends the link. The server binds the new session to the sign-in this phone is waiting on.
        await fetch(`${API_URL}/auth/verify?token=${encodeURIComponent(token)}`, { credentials: "omit" });
      } catch {
        if (live) setProblem("Could not reach ScriptumIQ. Check your connection and tap the link again.");
        return;
      }
      if (!live) return;
      if (!waiting) {
        // The link was asked for somewhere else, or its window closed: the sign-in finished in the
        // browser's place, not this phone's, so say what to do rather than wait for nothing.
        setProblem("This link was for a sign-in that is not waiting on this phone. Sign in here to get a new one.");
        return;
      }
      // The sign-in screen picks the waiting sign-in up from the keychain and collects the session.
      router.replace("/sign-in");
    })();
    return () => {
      live = false;
    };
  }, [session, token, router]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, backgroundColor: color.parchment }}>
      {problem ? (
        <>
          <Text style={[type.heading, { marginBottom: space.sm, textAlign: "center" }]}>Sign-in link</Text>
          <Text style={[type.bodyMuted, { textAlign: "center", marginBottom: space.lg }]}>{problem}</Text>
          <Text onPress={() => router.replace("/sign-in")} style={[type.body, { color: color.goldText, textDecorationLine: "underline" }]}>
            Go to sign in
          </Text>
        </>
      ) : (
        <>
          <ActivityIndicator color={color.midnight} />
          <Text style={[type.small, { marginTop: space.md }]}>Signing you in…</Text>
        </>
      )}
    </View>
  );
}
