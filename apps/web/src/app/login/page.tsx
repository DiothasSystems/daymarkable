import { redirect } from "next/navigation";
import { Emblem, Wordmark } from "@/components/Brand";
import { Shell } from "@/components/Shell";
import { serviceUrl } from "@/lib/hosts";
import { getSessionUser } from "@/server/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Login" };
export const dynamic = "force-dynamic";

/**
 * Sign-in: a password, then a link emailed to the account's address (server/sign-in.ts).
 *
 *   ?reset=1       open on "set or reset your password" — where the mails send people
 *   ?password=set  a password was just chosen; sign in with it
 *   ?expired=1     a sign-in link was spent or ran out
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string; reset?: string; password?: string }> }) {
  if (await getSessionUser()) redirect(`${serviceUrl()}/today`);
  const { expired, reset, password } = await searchParams;
  return (
    <Shell>
      <div className="login">
        <Emblem size={120} className="emblem" />
        <div style={{ marginTop: 14 }}>
          <Wordmark size={34} />
        </div>
        <div className="tagline">Your thoughts. Your next move.</div>
        <div className="card" style={{ textAlign: "left" }}>
          <p className="kicker">Login</p>
          <h2 style={{ marginBottom: 6 }}>Your notes, decoded nightly.</h2>
          <p className="muted" style={{ fontSize: 14 }}>
            Enter your email and password. We then email you a one-time link to finish signing in, so it takes both your
            password and your mailbox.
          </p>
          {expired ? <div className="notice bad" style={{ marginBottom: 12 }}>That sign-in link has expired or was already used. Sign in again for a new one.</div> : null}
          {password === "set" ? <div className="notice ok" style={{ marginBottom: 12 }}>Your password is saved. Sign in with it now.</div> : null}
          <LoginForm initialMode={reset ? "reset" : "signin"} />
        </div>
      </div>
    </Shell>
  );
}
