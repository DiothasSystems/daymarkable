/**
 * The shell: brand fonts, then the session, then whatever route is showing.
 *
 * The fonts are the ones the composer prints with — loaded straight out of packages/compose
 * rather than copied here, so the tablet page, the email, the web and the app cannot drift into
 * three different Public Sans.
 *
 * The splash comes in two halves, and it has to.
 *
 * Android 12 and later mask the NATIVE splash icon to a circle — the platform's own splash API,
 * not a choice Expo makes — so a wide lockup put there is cropped to a band through its middle.
 * The native half therefore shows the emblem, which is circular and survives intact. The app then
 * draws the full lockup itself, over the same Parchment ground, so the handover is invisible and
 * the whole logo is what the user actually sees.
 *
 * Three seconds, measured from launch rather than from when the fonts land, so a slow font load
 * eats into the hold instead of adding to it. On a fast phone the logo would otherwise flash past
 * before it could be read, and this is the one moment the product introduces itself.
 */
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "@/session";
import { color } from "@/theme";

const SPLASH_MS = 3000;

void SplashScreen.preventAutoHideAsync();

/** The app's own half of the splash: the full lockup on the native splash's Parchment. */
function Lockup() {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: color.parchment, alignItems: "center", justifyContent: "center" }]}>
      <Image source={require("../assets/splash-lockup.png")} style={{ width: 260, height: 260 }} resizeMode="contain" />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    SourceSerif: require("../../../packages/compose/fonts/SourceSerif4-Semibold.ttf"),
    SourceSerifBold: require("../../../packages/compose/fonts/SourceSerif4-Bold.ttf"),
    PublicSans: require("../../../packages/compose/fonts/PublicSans-Regular.ttf"),
    PublicSansMedium: require("../../../packages/compose/fonts/PublicSans-Medium.ttf"),
    PublicSansBold: require("../../../packages/compose/fonts/PublicSans-Bold.ttf"),
    IBMPlexMono: require("../../../packages/compose/fonts/IBMPlexMono-Medium.ttf"),
  });

  const [held, setHeld] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setHeld(false), SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // Lift the native splash the moment this component is up, because what replaces it is the
    // lockup — the same artwork, the same ground, and the whole logo rather than the circular
    // crop Android allows natively. Waiting for the fonts would show the emblem the entire time.
    void SplashScreen.hideAsync();
  }, []);

  // The lockup covers BOTH waits: the three-second hold and however long the six brand fonts take
  // to load. Gating it on the fonts was a bug — they took longer than the hold, so the timer
  // expired against a blank screen and the logo never appeared at all. The lockup is an image and
  // needs no fonts, so it can be shown before they arrive.
  if (held || !fontsLoaded) return <Lockup />;

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: color.parchment },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="web/[pane]" options={{ presentation: "modal" }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
