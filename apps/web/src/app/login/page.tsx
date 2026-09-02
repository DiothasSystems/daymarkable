import { redirect } from "next/navigation";
import { Emblem, Wordmark } from "@/components/Brand";
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
      <div className="login">
        <Emblem size={120} className="emblem" />
        <div style={{ marginTop: 14 }}>
          <Wordmark size={34} />
        </div>
        <div className="tagline">Note to Action Organizer</div>
        <div className="card" style={{ textAlign: "left" }}>
          <p className="kicker">Sign in</p>
          <h2 style={{ marginBottom: 6 }}>Your notes, decoded nightly.</h2>
          <p className="muted" style={{ fontSize: 14 }}>Enter the email you registered. We send a one-time sign-in link; meeting notes go to the same address.</p>
          {expired ? <div className="notice bad" style={{ marginBottom: 12 }}>That sign-in link has expired or was already used. Request a new one.</div> : null}
          <LoginForm />
        </div>
      </div>
    </Shell>
  );
}
