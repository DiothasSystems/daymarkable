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
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View, type TextStyle } from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { errorMessage, siteUrl, trpc } from "@/api";
import { Hero } from "@/components/Hero";
import { clearPendingSignIn, loadPendingSignIn, savePendingSignIn } from "@/pendingSignIn";
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

  // A sign-in already waiting for its link — the app was closed while its owner opened their mail,
  // or the link itself just opened the app (app/auth/app.tsx) — carries on rather than starting over.
  useEffect(() => {
    let live = true;
    void loadPendingSignIn().then((p) => {
      if (!live || !p) return;
      secret.current = p.pollSecret;
      deadline.current = p.deadline;
      setEmail(p.email);
      setStage("waiting");
    });
    return () => {
      live = false;
    };
  }, []);

  /*
   * Keeping the field being typed in above the keyboard. Android draws edge to edge now, so the
   * window no longer shrinks when the keyboard opens and KeyboardAvoidingView has nothing to react
   * to: the keyboard simply covered the password box. The keyboard's height is padded onto the
   * bottom of the scroll, and the focused field is scrolled to just under the top.
   */
  const scroll = useRef<ScrollView>(null);
  const fieldY = useRef<Record<string, number>>({});
  const focused = useRef<string | null>(null);
  const [keyboard, setKeyboard] = useState(0);
  const reveal = useCallback(() => {
    const y = focused.current ? fieldY.current[focused.current] : undefined;
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - space.xl * 3), animated: true });
  }, []);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      setKeyboard(e.endCoordinates.height);
      // After the padding lands, or there is nothing yet to scroll into.
      setTimeout(reveal, 50);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [reveal]);
  const track = (name: string) => ({
    onLayout: (e: { nativeEvent: { layout: { y: number } } }) => {
      fieldY.current[name] = e.nativeEvent.layout.y;
    },
    onFocus: () => {
      focused.current = name;
      if (keyboard) reveal();
    },
  });

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
      // Kept in the keychain too: the link opens in this app, which Android may have closed meanwhile.
      if (secret.current) await savePendingSignIn({ pollSecret: secret.current, deadline: deadline.current, email: address });
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
        void clearPendingSignIn();
        setStage("timeout");
        return;
      }
      try {
        const r = await trpc.auth.claim.mutate({ pollSecret: secret.current });
        if (!live) return;
        if (r.status === "ready") {
          await clearPendingSignIn();
          await signIn(r.sessionId);
          router.replace("/");
          return;
        }
        if (r.status === "expired") {
          void clearPendingSignIn();
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
    void clearPendingSignIn();
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
      {...track("email")}
    />
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.parchment }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: space.xl, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl + (Platform.OS === "android" ? keyboard : 0) }}
        keyboardShouldPersistTaps="handled"
      >
        {/* The scene the site opens with, scaled to the phone, and a way into the tour for the one
            visitor who has no other: someone who installed the app before knowing what it does.
            Only on the form - the waiting stages have their own thing to say, and a looping
            animation over "check your mail" competes with it. */}
        {stage === "form" ? (
          <View style={{ marginLeft: -space.xl, marginRight: -space.xl, marginBottom: space.lg }}>
            <Hero onPress={() => router.push("/tour")} />
          </View>
        ) : null}

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
            <PasswordField
              value={password}
              onChange={setPassword}
              onSubmit={() => void request()}
              editable={!busy}
              track={track("password")}
            />
            <Pressable
              onPress={() => backTo("reset", true)}
              accessibilityRole="button"
              style={{ minHeight: TOUCH_TARGET, justifyContent: "center", alignSelf: "flex-end", marginTop: -space.sm, marginBottom: space.sm }}
            >
              <Text style={{ fontFamily: font.sans, fontSize: 15, color: color.goldText, textDecorationLine: "underline" }}>Forgot password?</Text>
            </Pressable>
            <PrimaryButton label={busy ? "Checking…" : "Sign in"} onPress={() => void request()} disabled={busy || !email.trim() || !password} />
            {/* The one screen someone without an account can reach. Registration is closed
                (rule 15), so this is also the only place the app can honestly explain itself to
                a stranger who has just installed it. */}
            <LinkButton label="What is ScriptumIQ?" onPress={() => router.push("/tour")} />
            <View style={{ marginTop: space.xl }}>
              <Register />
            </View>
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

/**
 * Getting an account, which is a thing this app cannot do and must not pretend to.
 *
 * Registration is closed and an invitation is the whole of what opens it (rule 15), so there is no
 * form here to fill in - the site's own page is where an address is taken, and where someone who
 * already has an account is told to go and sign in instead. It opens in the phone's browser rather
 * than a WebView: nothing here is signed in, so there is no session to hand across, and a frame
 * that looks like the app but is the open web is the wrong thing to put a stranger in.
 */
/**
 * The password box, with an eye that shows what was typed. A password typed blind on a phone keyboard
 * is a password typed wrong, and five of those lock the address (rule 18). Hidden is the default,
 * every time the screen opens.
 */
function PasswordField({
  value,
  onChange,
  onSubmit,
  editable,
  track,
}: {
  value: string;
  onChange(v: string): void;
  onSubmit(): void;
  editable: boolean;
  track: { onLayout(e: { nativeEvent: { layout: { y: number } } }): void; onFocus(): void };
}) {
  const [shown, setShown] = useState(false);
  return (
    <View onLayout={track.onLayout} style={{ marginBottom: space.md, justifyContent: "center" }}>
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={track.onFocus}
        placeholder="Password"
        placeholderTextColor={color.meta}
        secureTextEntry={!shown}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        editable={editable}
        accessibilityLabel="Password"
        style={[input, { marginBottom: 0, paddingRight: TOUCH_TARGET + space.xs }]}
      />
      <Pressable
        onPress={() => setShown((s) => !s)}
        accessibilityRole="button"
        accessibilityLabel={shown ? "Hide password" : "Show password"}
        hitSlop={4}
        style={({ pressed }) => ({ position: "absolute", right: 0, width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
      >
        <Eye open={!shown} />
      </Pressable>
    </View>
  );
}

/** An eye, struck through once the password is showing: tap to hide it again. */
function Eye({ open }: { open: boolean }) {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color.midnight} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <Circle cx={12} cy={12} r={3} />
      {open ? null : <Line x1={3} y1={21} x2={21} y2={3} />}
    </Svg>
  );
}

function Register() {
  return <PrimaryButton label="Register" onPress={() => void Linking.openURL(`${siteUrl()}/start`)} outline />;
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

/**
 * The two choices under Sign in, set like the wordmark above them.
 *
 * `type.title` rather than a size copied out of it, so the wordmark and these stay the same size
 * by construction — the brand's display face at 24pt, which is what makes them read as offers
 * rather than as the small print a 15pt sans link becomes. Gold and underlined still: that is the
 * palette's tertiary link, and the colour is what says these are choices and Sign in is the act.
 */
function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={{ minHeight: TOUCH_TARGET, justifyContent: "center", marginTop: space.md }}>
      <Text style={[type.title, { color: color.goldText, textDecorationLine: "underline" }]}>{label}</Text>
    </Pressable>
  );
}
