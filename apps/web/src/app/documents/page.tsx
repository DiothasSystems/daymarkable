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
      <p className="muted">Served from the 1-day cache and the registry, never regenerated. Yesterday's files are gone by design; tonight's run replaces them. Click any decoded text to fix a misread — the correction is learned, then push it to the tablet below.</p>
      <div style={{ marginBottom: 18 }}><Republish /></div>
      <DocumentsView documents={docs.documents} registry={reg} initialTab={tab ?? "files"} />
    </Shell>
  );
}
