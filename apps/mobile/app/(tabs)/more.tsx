/**
 * Everything that is not a list: Sync now, how well it read, what you want changed, and the way out.
 *
 * The night's notebooks are NOT offered here. They used to be, as PDFs; the app holds the same
 * material as live data on the three tabs beside this one, and those are better on a phone in
 * every way that matters — they reflow, and their items can be ticked and edited where they are
 * read. Duplicating them as buttons here only offered a worse copy of what the tab bar already
 * reaches. The printed page is for the tablet.
 *
 * Two things are deliberately absent and must stay that way:
 *
 *   No price, no purchase, no link to one (rule 14). Subscription lives on the web, and the app
 *   does not learn what anything costs — the Subscription button below opens the web's own
 *   page in a WebView, which is where every figure and every card field stays.
 *
 *   No regeneration. A view never makes work (rule 12).
 */
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "@/api";
import { Feedback } from "@/components/Feedback";
import { SyncNow } from "@/components/SyncNow";
import { Button, Card, ErrorNote, Label, Loading } from "@/components/ui";
import { useSession } from "@/session";
import { useQuery, useReloadOnReturn } from "@/useApi";
import { space, type } from "@/theme";

type Docs = Awaited<ReturnType<typeof trpc.documents.list.query>>;
type Quota = Awaited<ReturnType<typeof trpc.runs.quota.query>>;
type Me = Awaited<ReturnType<typeof trpc.auth.me.query>>;

export default function More() {
  const insets = useSafeAreaInsets();
  const { signOut } = useSession();
  const router = useRouter();
  const docs = useQuery<Docs>(() => trpc.documents.list.query(), []);
  const quota = useQuery<Quota>(() => trpc.runs.quota.query(), []);
  const me = useQuery<Me>(() => trpc.auth.me.query(), []);

  const refreshAll = useCallback(async () => {
    await Promise.all([docs.reload(), quota.reload()]);
  }, [docs, quota]);
  useReloadOnReturn(refreshAll);

  /** End it on the server too, so the row goes rather than merely being forgotten here. */
  const endSession = useCallback(async () => {
    try {
      await trpc.auth.logout.mutate();
    } catch {
      // Already invalid, or no network. Either way the phone stops holding it.
    }
    await signOut();
  }, [signOut]);

  if (docs.loading) return <Loading />;

  const run = docs.data?.run ?? null;

  return (
    <ScrollView
      contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.xxl }}
      refreshControl={<RefreshControl refreshing={docs.refreshing || quota.refreshing} onRefresh={() => void refreshAll()} />}
    >
      <View style={{ paddingHorizontal: space.lg, marginBottom: space.lg }}>
        <Label>MORE</Label>
        <Text style={[type.title, { marginTop: space.xs }]}>{me.data?.email ?? "Your account"}</Text>
      </View>

      {docs.error ? <ErrorNote>{docs.error}</ErrorNote> : null}

      <View style={{ paddingHorizontal: space.lg, gap: space.lg }}>
        <Card>
          <Label style={{ marginBottom: space.sm }}>READ MY TABLET</Label>
          <Text style={[type.small, { marginBottom: space.md }]}>
            Reads the pages you changed today and rebuilds everything. This replaces tonight's
            automatic run.
          </Text>
          <SyncNow quota={quota.data} onFinished={() => void refreshAll()} />
        </Card>

        <Feedback runId={run?.id ?? null} />

        <Card>
          <Label style={{ marginBottom: space.sm }}>ACCOUNT</Label>
          {/* The web's own pages, signed in (app/web/[pane].tsx). One copy of each form, and no
              price anywhere in this app — subscription included (rule 14). */}
          <View style={{ gap: space.sm }}>
            {/* No "Your tablet and conventions" button. /setup redirects an onboarded account
                straight to /account (apps/web/src/app/setup/page.tsx), so it was a second button
                to the page Settings already opens. The setup pane itself stays: app/index.tsx
                sends an account that has NOT onboarded into that wizard, which is the one time
                the page shows anything of its own. */}
            <Button title="Settings" variant="secondary" onPress={() => router.push({ pathname: "/web/[pane]", params: { pane: "settings" } })} />
            <Button title="Subscription" variant="secondary" onPress={() => router.push({ pathname: "/web/[pane]", params: { pane: "billing" } })} />
            <Button title="Support" variant="secondary" onPress={() => router.push({ pathname: "/web/[pane]", params: { pane: "support" } })} />
          </View>
          <View style={{ marginTop: space.lg }}>
            <Button title="Sign out" variant="tertiary" onPress={() => void endSession()} />
          </View>
        </Card>
      </View>
    </ScrollView>
  );
}
