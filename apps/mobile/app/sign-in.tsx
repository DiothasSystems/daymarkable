/**
 * Sign in, the phone's way (`apps/web/src/server/device-login.ts`).
 *
 * Ask for a link, then wait. The link is tapped wherever the user's mail happens to be — often a
 * laptop — and this screen is holding the secret that the session gets handed to. That is why
 * there is a spinner here rather than a deep-link callback: the phone need not be the device that
 * opens the mail.
 *
 * The server answers the same for an address that may sign in and one that may not (rule 15), so
 * this screen must not pretend to know either. It says "check your mail" to everyone, waits, and
 * eventually says the wait is over without ever saying why.
 */
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorMessage, trpc } from "@/api";
import { useSession } from "@/session";
import { TOUCH_TARGET, color, font, radius, space, type } from "@/theme";

/** Matches the server's own window: the login token and the waiting row both die at 15 minutes. */
const DEADLINE_MS = 15 * 60_000;
const POLL_MS = 2_000;

type Stage = "email" | "waiting" | "timeout";

export default function SignIn() {
  const router = useRouter();
  const { signIn } = useSession();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<Stage>("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secret = useRef<string | null>(null);
  const deadline = useRef(0);

  const request = useCallback(async () => {
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const r = await trpc.auth.requestLink.mutate({ email: address, client: "mobile" });
      // Always present for a mobile request — including when no link was sent, which is what
      // stops this screen from being able to tell whether the address has an account.
      secret.current = r.pollSecret ?? null;
      deadline.current = Date.now() + DEADLINE_MS;
      setStage(secret.current ? "waiting" : "timeout");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [email]);

  useEffect(() => {
    if (stage !== "waiting" || !secret.current) return;
    let live = true;
    const tick = async () => {
      if (!live || !secret.current) return;
      if (Date.now() > deadline.current) {
        setStage("timeout");
        return;
      }
      try {
        const r = await trpc.auth.claim.mutate({ pollSecret: secret.current });
        if (!live) return;
        if (r.status === "ready") {
          await signIn(r.sessionId);
          router.replace("/");
          return;
        }
        if (r.status === "expired") {
          setStage("timeout");
          return;
        }
      } catch {
        // A poll that fails is a phone on a bad train, not a failed sign-in. Keep waiting.
      }
      if (live) timer = setTimeout(() => void tick(), POLL_MS);
    };
    let timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [stage, router, signIn]);

  /**
   * Back to the form. The two ways of getting here want different things, so they are two calls
   * rather than one:
   *
   *   "Use a different address" means this one was wrong — clear it. Leaving it put the next
   *   thing typed on the end of the old one, which is how "a@b.testa@b.test" gets sent.
   *   "Try again" after an expiry means the link ran out, not that the address was wrong — keep
   *   it, so the user can send another without retyping, or fix a typo in place.
   */
  const backToForm = useCallback((keepAddress: boolean) => {
    secret.current = null;
    if (!keepAddress) setEmail("");
    setError(null);
    setStage("email");
  }, []);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.parchment }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[type.label, { marginBottom: space.sm }]}>DAYMARKABLE</Text>
        <Text style={[type.title, { marginBottom: space.lg }]}>
          Scriptum<Text style={{ color: color.goldText }}>IQ</Text>
        </Text>

        {stage === "email" ? (
          <>
            <Text style={[type.bodyMuted, { marginBottom: space.lg }]}>
              Sign in with the address your notes are sent to. We will email you a link — no password.
            </Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={color.meta}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              returnKeyType="go"
              onSubmitEditing={() => void request()}
              editable={!busy}
              accessibilityLabel="Email address"
              style={{
                minHeight: TOUCH_TARGET,
                backgroundColor: color.notepaper,
                borderColor: color.borderStrong,
                borderWidth: 1,
                borderRadius: radius.button,
                paddingHorizontal: space.md,
                fontFamily: font.sans,
                fontSize: 16,
                color: color.midnight,
                marginBottom: space.md,
              }}
            />
            <Pressable
              onPress={() => void request()}
              disabled={busy || !email.trim()}
              accessibilityRole="button"
              style={({ pressed }) => ({
                minHeight: TOUCH_TARGET,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.button,
                backgroundColor: color.midnight,
                opacity: busy || !email.trim() ? 0.5 : pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ fontFamily: font.sansBold, fontSize: 15, color: color.parchment }}>
                {busy ? "Sending…" : "Email me a link"}
              </Text>
            </Pressable>
          </>
        ) : null}

        {stage === "waiting" ? (
          <View accessibilityLiveRegion="polite">
            <Text style={[type.heading, { marginBottom: space.sm }]}>Check your mail</Text>
            <Text style={[type.bodyMuted, { marginBottom: space.lg }]}>
              If {email.trim()} can sign in, a link is on its way. Open it anywhere — this phone, your
              laptop — and you will land here signed in.
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.xl }}>
              <ActivityIndicator color={color.gold} />
              <Text style={type.small}>Waiting for the link…</Text>
            </View>
            <Pressable onPress={() => backToForm(false)} accessibilityRole="button" style={{ minHeight: TOUCH_TARGET, justifyContent: "center" }}>
              <Text style={{ fontFamily: font.sans, fontSize: 15, color: color.goldText, textDecorationLine: "underline" }}>
                Use a different address
              </Text>
            </Pressable>
          </View>
        ) : null}

        {stage === "timeout" ? (
          <View accessibilityLiveRegion="polite">
            <Text style={[type.heading, { marginBottom: space.sm }]}>That link has expired</Text>
            <Text style={[type.bodyMuted, { marginBottom: space.xl }]}>
              Links last fifteen minutes. Ask for another one, and check that the address is the one
              your ScriptumIQ account uses.
            </Text>
            <Pressable
              onPress={() => backToForm(true)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                minHeight: TOUCH_TARGET,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: radius.button,
                borderWidth: 1.5,
                borderColor: color.midnight,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text style={{ fontFamily: font.sansBold, fontSize: 15, color: color.midnight }}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {error ? <Text style={[type.small, { color: color.bad, marginTop: space.md }]}>{error}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
