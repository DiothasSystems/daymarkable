"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConventionsPicker, EmailPrefs, PairingWizard, TimezonePicker, WatchFolders } from "@/components/SettingsForms";
import { errorMessage, trpc } from "@/lib/trpc";
import type { getAccount } from "@/server/services";

type Account = Awaited<ReturnType<typeof getAccount>>;
const STEPS = ["Pair tablet", "Watch folders", "Timezone", "Ink conventions", "Email"];

export function SetupWizard({ account }: { account: Account }) {
  const router = useRouter();
  const [step, setStep] = useState(account.tablet.paired ? 1 : 0);
  const [paired, setPaired] = useState(account.tablet.paired);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    try {
      await trpc.account.completeOnboarding.mutate();
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="card">
      <div className="steps">
        {STEPS.map((s, i) => (
          <span key={s} className={i === step ? "on" : i < step ? "done" : ""}>{i + 1}. {s}</span>
        ))}
      </div>
      <h2>{STEPS[step]}</h2>
      {step === 0 ? <PairingWizard tablet={account.tablet} onPaired={() => setPaired(true)} /> : null}
      {step === 1 ? <WatchFolders initial={account.settings.watchFolders} includePdfs={account.settings.includePdfs} paired={paired} /> : null}
      {step === 2 ? <TimezonePicker initial={account.timezone} /> : null}
      {step === 3 ? <ConventionsPicker initial={account.settings.conventions} catalog={account.conventionCatalog} /> : null}
      {step === 4 ? <EmailPrefs initial={account.settings.email} email={account.email} /> : null}
      {error ? <div className="notice bad">{error}</div> : null}
      <div className="row between" style={{ marginTop: 20 }}>
        <button className="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</button>
        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep((s) => s + 1)} disabled={step === 0 && !paired}>{step === 0 && !paired ? "Pair first" : "Next"}</button>
        ) : (
          <button className="primary" onClick={() => void finish()}>Finish setup</button>
        )}
      </div>
    </div>
  );
}
