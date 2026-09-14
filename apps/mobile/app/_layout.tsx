/**
 * The shell: brand fonts, then the session, then whatever route is showing.
 *
 * The fonts are the ones the composer prints with — loaded straight out of packages/compose
 * rather than copied here, so the tablet page, the email, the web and the app cannot drift into
 * three different Public Sans.
 */
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "@/session";
import { color } from "@/theme";

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    SourceSerif: require("../../../packages/compose/fonts/SourceSerif4-Semibold.ttf"),
    SourceSerifBold: require("../../../packages/compose/fonts/SourceSerif4-Bold.ttf"),
    PublicSans: require("../../../packages/compose/fonts/PublicSans-Regular.ttf"),
    PublicSansMedium: require("../../../packages/compose/fonts/PublicSans-Medium.ttf"),
    PublicSansBold: require("../../../packages/compose/fonts/PublicSans-Bold.ttf"),
    IBMPlexMono: require("../../../packages/compose/fonts/IBMPlexMono-Medium.ttf"),
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: color.parchment, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={color.midnight} />
      </View>
    );
  }

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
