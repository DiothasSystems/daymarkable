/**
 * The gate. Read the keychain, ask who this is, then send them where they belong.
 *
 * An account that has not finished setting up goes to the setup pane rather than to a list that
 * would be empty and unexplained — which is what SW-009 means by completing first-time setup in
 * the app. The pane is the web's own wizard in a WebView, and the server's guard chain decides
 * from there: an account that has not checked out is sent to billing before it ever sees setup.
 *
 * It renders nothing of its own on purpose — a splash that flashes a wrong answer for a frame is
 * worse than a spinner that waits for the right one.
 */
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { trpc } from "@/api";
import { useSession } from "@/session";
import { useQuery } from "@/useApi";
import { color } from "@/theme";

type Me = Awaited<ReturnType<typeof trpc.auth.me.query>>;

export default function Index() {
  const { session } = useSession();
  const me = useQuery<Me>(() => (session ? trpc.auth.me.query() : Promise.resolve(null)), [session]);

  // undefined = the keychain has not answered yet.
  if (session === undefined || (session && me.loading)) return <Waiting />;
  if (session === null) return <Redirect href="/sign-in" />;
  // A session the server does not recognise signs the app out through useQuery; until it does,
  // hold rather than guess.
  if (me.error) return <Waiting />;
  if (me.data && !me.data.onboardedAt) return <Redirect href={{ pathname: "/web/[pane]", params: { pane: "setup" } }} />;
  return <Redirect href="/actions" />;
}

function Waiting() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: color.parchment }}>
      <ActivityIndicator color={color.midnight} />
    </View>
  );
}
