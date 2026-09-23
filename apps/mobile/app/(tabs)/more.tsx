/**
 * Everything that is not a list: the night's documents, Sync now, how well it read, what you
 * want changed, and the way out.
 *
 * Two things are deliberately absent and must stay that way:
 *
 *   No price, no purchase, no link to one (rule 14). Subscription lives on the web, and the app
 *   does not learn what anything costs — the Subscription button below opens the web's own
 *   billing page in a WebView, which is where every figure and every card field stays.
 *
 *   No regeneration. Documents are read from the 1-day cache; a view never makes work (rule 12).
 */
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "@/api";
import { Feedback } from "@/components/Feedback";
import { SyncNow } from "@/components/SyncNow";
import { Button, Card, Empty, ErrorNote, Label, Loading } from "@/components/ui";
import { dayTitle } from "@/format";
import { useSession } from "@/session";
import { useQuery, useReloadOnReturn } from "@/useApi";
import { space, type } from "@/theme";

type Docs = Awaited<ReturnType<typeof trpc.documents.list.query>>;
type Quota = Awaited<ReturnType<typeof trpc.runs.quota.query>>;
type Me = Awaited<ReturnType<typeof trpc.auth.me.query>>;

/**
 * What the night produced, and where to read it on a phone.
 *
 * The phone does not open the PDFs, and this is the reason the card still exists rather than the
 * buttons simply being deleted. Each notebook has a screen here that holds the same material as
 * live data — the action list is the Actions tab, the planner is the Calendar tab, the meeting
 * notes are the Notes tab — and those screens are better than the page in every way that matters
 * on a phone: they reflow, they are searchable, and their items can be ticked and edited, which a
 * PDF handed to whatever viewer is installed cannot be. The printed page is for the tablet.
 *
 * The dayLy Update and the dayLy Puzzle are absent for a different reason: they have no native
 * screen and are not meant to. The puzzle is three pages of grid to be written on with a stylus
 * and the brief is a page to read at breakfast; neither survives being a phone document. They stay
 * on the tablet.
 *
 * The web viewer still serves every document — this is the app declining to, not the run changing.
 */
/** The kind comes from the server's own union, so a notebook named wrongly here will not compile. */
type DocumentKind = Docs["documents"][number]["kind"];

const NOTEBOOKS: readonly { kind: DocumentKind; title: string; href: "/actions" | "/calendar" | "/notes" }[] = [
  { kind: "action_list", title: "Action List", href: "/actions" },
  { kind: "planner", title: "Planner", href: "/calendar" },
  { kind: "meeting_notes", title: "Meeting Notes", href: "/notes" },
];

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
  // Only offer a notebook the night actually produced: a link to an empty Notes tab reads as a
  // broken feature, where its absence reads as "no meetings yesterday", which is the truth.
  const produced = new Set((docs.data?.documents ?? []).map((d) => d.kind));
  const shown = NOTEBOOKS.filter((n) => produced.has(n.kind));

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

        <Card>
          <Label style={{ marginBottom: space.sm }}>
            {run ? `FROM ${dayTitle(run.localDate).toUpperCase()}` : "YOUR NOTEBOOKS"}
          </Label>
          {!shown.length ? (
            <Empty>Nothing read yet. Press Sync now, or wait for the run just after midnight.</Empty>
          ) : (
            <View style={{ gap: space.sm }}>
              {shown.map((n) => (
                <Button key={n.kind} title={`Open ${n.title}`} variant="secondary" onPress={() => router.push(n.href)} />
              ))}
              <Text style={[type.small, { marginTop: space.xs }]}>
                The printed pages went to your tablet. Kept for a day and then deleted — that is the
                whole of what dayMarkable stores.
              </Text>
            </View>
          )}
        </Card>

        <Feedback runId={run?.id ?? null} />

        <Card>
          <Label style={{ marginBottom: space.sm }}>ACCOUNT</Label>
          {/* The web's own pages, signed in (app/web/[pane].tsx). One copy of each form, and no
              price anywhere in this app — subscription included (rule 14). */}
          <View style={{ gap: space.sm }}>
            <Button title="Settings" variant="secondary" onPress={() => router.push({ pathname: "/web/[pane]", params: { pane: "settings" } })} />
            <Button title="Your tablet and conventions" variant="secondary" onPress={() => router.push({ pathname: "/web/[pane]", params: { pane: "setup" } })} />
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
