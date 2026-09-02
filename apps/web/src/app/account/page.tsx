import { Shell } from "@/components/Shell";
import { RateRun } from "@/components/RateRun";
import { ConventionsPicker, DecodeTuning, EmailPrefs, PairingWizard, TimezonePicker, WatchFolders } from "@/components/SettingsForms";
import { fmtDateTime } from "@/lib/format";
import { requireUser } from "@/server/guard";
import { feedbackSummary, getAccount, listRuns } from "@/server/services";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser();
  const [account, feedback, runs] = await Promise.all([getAccount(user.id), feedbackSummary(user.id), listRuns(user.id, 1)]);
  const lastRun = runs.find((r) => r.status === "succeeded") ?? null;
  return (
    <Shell>
      <div className="row between">
        <div>
          <p className="kicker">{account.email} · {account.status}</p>
          <h1>Account</h1>
        </div>
        <form action="/auth/logout" method="post"><button className="secondary small" type="submit">Sign out</button></form>
      </div>

      <div className="grid two">
        <section className="card">
          <h2>Conversion quality</h2>
          <p className="muted">How well did dayMarkable read your handwriting? {feedback.count ? <>Average <strong>{feedback.average!.toFixed(1)}</strong> over {feedback.count} rating{feedback.count === 1 ? "" : "s"}.</> : "No ratings yet."}</p>
          {lastRun ? <p className="meta">Rating the latest run ({lastRun.label.toLowerCase()}, {fmtDateTime(lastRun.finishedAt, user.timezone)})</p> : <p className="meta">Rating overall (no run yet)</p>}
          <RateRun runId={lastRun?.id ?? null} initialRating={lastRun?.rating?.rating ?? null} initialComment={lastRun?.rating?.comment ?? null} />
        </section>
        <section className="card">
          <h2>Tablet</h2>
          <PairingWizard tablet={account.tablet} />
        </section>
        <section className="card">
          <h2>Watch folders</h2>
          <WatchFolders initial={account.settings.watchFolders} includePdfs={account.settings.includePdfs} paired={account.tablet.paired} />
        </section>
        <section className="card">
          <h2>Timezone</h2>
          <TimezonePicker initial={account.timezone} />
        </section>
        <section className="card">
          <h2>Ink conventions</h2>
          <ConventionsPicker initial={account.settings.conventions} catalog={account.conventionCatalog} />
        </section>
        <section className="card">
          <h2>Email</h2>
          <EmailPrefs initial={account.settings.email} email={account.email} />
        </section>
        <section className="card">
          <h2>Decoding</h2>
          <DecodeTuning threshold={account.settings.confidenceThreshold} decodeModel={account.settings.decodeModel} escalationModel={account.settings.escalationModel} />
        </section>
        <section className="card">
          <h2>Privacy</h2>
          <p className="muted">Your note pages and generated notebooks stay in dayMarkable's systems for at most 24 hours: each run keeps one day of files and deletes the previous day's as its last step. Extracted tasks, events, and meeting notes are kept encrypted so the planner can be updated without re-reading your notes.</p>
          <p className="meta">Sync now: {account.quota.used} of {account.quota.limit} used in the rolling {account.quota.windowHours}h.</p>
        </section>
      </div>
    </Shell>
  );
}
