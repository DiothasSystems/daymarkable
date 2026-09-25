/**
 * Sign in, the phone's way (`apps/web/src/server/device-login.ts`, `sign-in.ts`).
 *
 * Two steps, as on the web: the password, and then a link emailed to the account's address. Only a
 * right password sends the link, and the link is what signs in — tapped wherever the user's mail
 * happens to be, often a laptop, while this screen holds the secret the session gets handed to.
 * That is why there is a spinner here rather than a deep-link callback: the phone need not be the
 * device that opens the mail.
 *
 * A wrong answer is one answer, whatever made it wrong — no account, no password yet, a wrong
 * password — so this screen cannot tell anyone who has an account (rule 15), and has to point at
 * "set or reset" rather than guess. Nobody has a password until they set one, from an emailed link
 * that opens in the phone's browser.
 */
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, type TextStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorMessage, trpc } from "@/api";
import { useSession } from "@/session";
import { TOUCH_TARGET, color, font, radius, space, type } from "@/theme";

/** Matches the server's own window: the login token and the waiting row both die at 15 minutes. */
const DEADLINE_MS = 15 * 60_000;
const POLL_MS = 2_000;

type Stage = "form" | "reset" | "reset-sent" | "waiting" | "timeout";

const input: TextStyle = {
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
};

export default function SignIn() {
  const router = useRouter();
  const { signIn } = useSession();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const secret = useRef<string | null>(null);
  const deadline = useRef(0);

  const request = useCallback(async () => {
    const address = email.trim();
    if (!address || !password) return;
    setBusy(true);
    setError(null);
    try {
      const r = await trpc.auth.requestLink.mutate({ email: address, password, client: "mobile" });
      setPassword("");
      if (!r.ok) {
        setError(
          r.reason === "locked"
            ? `Too many wrong passwords for this address. Try again in ${r.retryAfterMinutes} minute${r.retryAfterMinutes === 1 ? "" : "s"}, or set a new password.`
            : "That email and password do not match. If you have not set a password yet, or have forgotten it, set one below.",
        );
        return;
      }
      secret.current = r.pollSecret ?? null;
      deadline.current = Date.now() + DEADLINE_MS;
      setStage(secret.current ? "waiting" : "timeout");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [email, password]);

  const requestReset = useCallback(async () => {
    const address = email.trim();
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      // The same reply whatever happens to the address (rule 15), so the next screen is the same too.
      await trpc.auth.requestPasswordLink.mutate({ email: address });
      setStage("reset-sent");
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
   * Back to a form. "Use a different address" means this one was wrong — clear it, or the next
   * thing typed lands on the end of the old one. Everything else keeps the address, so the user can
   * try again without retyping it. The password is never kept.
   */
  const backTo = useCallback((next: "form" | "reset", keepAddress: boolean) => {
    secret.current = null;
    if (!keepAddress) setEmail("");
    setPassword("");
    setError(null);
    setStage(next);
  }, []);

  const emailField = (onSubmit: () => void) => (
    <TextInput
      value={email}
      onChangeText={setEmail}
      placeholder="you@example.com"
      placeholderTextColor={color.meta}
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="email"
      textContentType="username"
      keyboardType="email-address"
      inputMode="email"
      returnKeyType="next"
      onSubmitEditing={onSubmit}
      editable={!busy}
      accessibilityLabel="Email address"
      style={input}
    />
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.parchment }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[type.label, { marginBottom: space.sm }]}>SIGN IN</Text>
        <Text style={[type.title, { marginBottom: space.lg }]}>
          Scriptum<Text style={{ color: color.goldText }}>IQ</Text>
        </Text>

        {stage === "form" ? (
          <>
            <Text style={[type.bodyMuted, { marginBottom: space.lg }]}>
              Your email and password. We then email you a link to finish — open it anywhere, and this phone signs in.
            </Text>
            {emailField(() => undefined)}
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={color.meta}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void request()}
              editable={!busy}
              accessibilityLabel="Password"
              style={input}
            />
            <PrimaryButton label={busy ? "Checking…" : "Sign in"} onPress={() => void request()} disabled={busy || !email.trim() || !password} />
            <LinkButton label="First time, or forgot your password? Set one" onPress={() => backTo("reset", true)} />
          </>
        ) : null}

        {stage === "reset" ? (
          <>
            <Text style={[type.bodyMuted, { marginBottom: space.lg }]}>
              We will email you a link to choose a password. It opens in your browser; afterwards, come back here and sign in with it.
            </Text>
            {emailField(() => void requestReset())}
            <PrimaryButton label={busy ? "Sending…" : "Email me a link"} onPress={() => void requestReset()} disabled={busy || !email.trim()} />
            <LinkButton label="I have a password — sign in" onPress={() => backTo("form", true)} />
          </>
        ) : null}

        {stage === "reset-sent" ? (
          <View accessibilityLiveRegion="polite">
            <Text style={[type.heading, { marginBottom: space.sm }]}>Check your mail</Text>
            <Text style={[type.bodyMuted, { marginBottom: space.xl }]}>
              If {email.trim()} can sign in, a link to set your password is on its way. It lasts thirty minutes. Once you have
              chosen one, sign in with it here.
            </Text>
            <PrimaryButton label="Sign in" onPress={() => backTo("form", true)} />
          </View>
        ) : null}

        {stage === "waiting" ? (
          <View accessibilityLiveRegion="polite">
            <Text style={[type.heading, { marginBottom: space.sm }]}>Check your mail</Text>
            <Text style={[type.bodyMuted, { marginBottom: space.lg }]}>
              Your password was accepted, and a link is on its way to {email.trim()}. Open it anywhere — this phone, your
              laptop — and you will land here signed in.
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.xl }}>
              <ActivityIndicator color={color.gold} />
              <Text style={type.small}>Waiting for the link…</Text>
            </View>
            <LinkButton label="Use a different address" onPress={() => backTo("form", false)} />
          </View>
        ) : null}

        {stage === "timeout" ? (
          <View accessibilityLiveRegion="polite">
            <Text style={[type.heading, { marginBottom: space.sm }]}>That link has expired</Text>
            <Text style={[type.bodyMuted, { marginBottom: space.xl }]}>
              Links last fifteen minutes. Sign in again for a new one.
            </Text>
            <PrimaryButton label="Sign in again" onPress={() => backTo("form", true)} outline />
          </View>
        ) : null}

        {error ? <Text style={[type.small, { color: color.bad, marginTop: space.md }]}>{error}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PrimaryButton({ label, onPress, disabled = false, outline = false }: { label: string; onPress: () => void; disabled?: boolean; outline?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        minHeight: TOUCH_TARGET,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.button,
        ...(outline ? { borderWidth: 1.5, borderColor: color.midnight } : { backgroundColor: color.midnight }),
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ fontFamily: font.sansBold, fontSize: 15, color: outline ? color.midnight : color.parchment }}>{label}</Text>
    </Pressable>
  );
}

function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ minHeight: TOUCH_TARGET, justifyContent: "center", marginTop: space.sm }}>
      <Text style={{ fontFamily: font.sans, fontSize: 15, color: color.goldText, textDecorationLine: "underline" }}>{label}</Text>
    </Pressable>
  );
}
