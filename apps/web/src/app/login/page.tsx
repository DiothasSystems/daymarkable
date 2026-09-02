import { redirect } from "next/navigation";
import { Shell } from "@/components/Shell";
import { getSessionUser } from "@/server/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const { expired } = await searchParams;
  return (
    <Shell>
      <div className="card" style={{ maxWidth: 480, margin: "8vh auto 0" }}>
        <p className="kicker">Sign in</p>
        <h1>Your notes, decoded nightly.</h1>
        <p className="muted">Enter the email you registered. We send a one-time sign-in link; meeting notes go to the same address.</p>
        {expired ? <div className="notice bad" style={{ marginBottom: 12 }}>That sign-in link has expired or was already used. Request a new one.</div> : null}
        <LoginForm />
      </div>
    </Shell>
  );
}
