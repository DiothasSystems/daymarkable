import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { requireUser } from "@/server/guard";
import { getAccount, getCalibration } from "@/server/services";
import { SetupWizard } from "./SetupWizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up" };

export default async function SetupPage() {
  const user = await requireUser({ allowUnboarded: true });
  if (user.onboardedAt) redirect("/account");
  const [account, calibration] = await Promise.all([getAccount(user.id), getCalibration(user.id)]);
  return (
    <Shell>
      <p className="kicker">Account setup</p>
      <h1>Six steps, then never touch a keyboard again.</h1>
      <SetupWizard account={account} calibration={calibration} />
    </Shell>
  );
}
