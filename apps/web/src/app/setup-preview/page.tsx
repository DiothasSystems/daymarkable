/**
 * TEMPORARY — validation tool. To remove it: delete this folder and drop SETUP_PREVIEW from
 * docker-compose.yml and .env. Nothing outside the folder imports anything in it, so that is
 * the whole removal. (The calibration fix it was built to validate is a real fix and stays.)
 *
 * Why it exists: step 0 of the setup wizard is tablet pairing, and `Next` stays disabled until
 * a tablet is paired, so the calibration step cannot be reached without one. This route reaches
 * the same generation code with any writer profile and shows what comes back.
 */
import { notFound } from "next/navigation";
import { Shell } from "@/components/Shell";
import { getSessionUser } from "@/server/auth";
import { PassageLab } from "./PassageLab";
import { previewEnabled } from "./enabled";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calibration preview" };

export default async function SetupPreviewPage() {
  if (!previewEnabled()) notFound();
  const user = await getSessionUser();
  return (
    <Shell>
      <p className="kicker">Temporary · calibration validation</p>
      <h1>What a writer is asked to copy out.</h1>
      <p>
        The same generation the setup wizard runs at step 4, reachable without pairing a tablet. Nothing here is
        saved: no calibration row, no lexicon terms, no upload. Delete this section once the passages look right.
      </p>
      {user ? <PassageLab /> : <p className="mono">Sign in to use this page.</p>}
    </Shell>
  );
}
