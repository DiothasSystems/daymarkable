import { Republish } from "@/components/Republish";
import { Shell } from "@/components/Shell";
import { fmtDateTime } from "@/lib/format";
import { requireUser } from "@/server/guard";
import { getRegistry, listDocuments } from "@/server/services";
import { DocumentsView } from "./DocumentsView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const { tab } = await searchParams;
  const [docs, reg] = await Promise.all([listDocuments(user.id), getRegistry(user.id)]);
  return (
    <Shell>
      <div className="row between">
        <div>
          <p className="kicker">{docs.run ? `from the ${docs.run.kind === "nightly" ? "automatic" : "on-demand"} run · ${fmtDateTime(docs.run.finishedAt, user.timezone)}` : "no run yet"}</p>
          <h1>Documents</h1>
        </div>
      </div>
      <p className="muted">
        Click any decoded text to fix a misread. Tick an item to close it, or ✕ to drop one that is not relevant — the
        same as crossing it out on paper. Every edit rebuilds the documents straight away, so the Documents tab always
        shows what your lists actually say. Yesterday&apos;s files are gone by design; tonight&apos;s run replaces them.
      </p>
      {docs.pendingDelivery ? (
        <div className="notice" style={{ marginBottom: 18 }}>
          <strong>Your documents have changed since the tablet last had them.</strong> Rebuilt from your edits{" "}
          {fmtDateTime(new Date(docs.pendingDelivery), user.timezone)}. Sending costs nothing and does not use a sync.
          <div style={{ marginTop: 10 }}><Republish /></div>
        </div>
      ) : (
        <div style={{ marginBottom: 18 }}><Republish /></div>
      )}
      <DocumentsView documents={docs.documents} registry={reg} initialTab={tab} />
    </Shell>
  );
}
