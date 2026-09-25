import Link from "next/link";
import { Emblem, Wordmark } from "@/components/Brand";
import { Shell } from "@/components/Shell";
import { passwordLinkEmail } from "@/server/auth";
import { SetPasswordForm } from "./SetPasswordForm";

export const metadata = { title: "Set your password" };
export const dynamic = "force-dynamic";

/**
 * Where a set-password link lands (server/sign-in.ts). The link is checked before the form is shown,
 * so a spent or expired one says so rather than letting someone type a password into nothing.
 *
 * Choosing a password here signs nobody in. The form sends them to /login, where signing in takes
 * the new password and then a fresh link — the same two steps as every other time.
 */
export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const email = token ? await passwordLinkEmail(token) : null;
  return (
    <Shell>
      <div className="login">
        <Emblem size={96} className="emblem" />
        <div style={{ marginTop: 12 }}>
          <Wordmark size={30} />
        </div>
        <div className="card" style={{ textAlign: "left", marginTop: 20 }}>
          <p className="kicker">Password</p>
          {email && token ? (
            <>
              <h2 style={{ marginBottom: 6 }}>Choose your password</h2>
              <p className="muted" style={{ fontSize: 14 }}>
                For <strong>{email}</strong>. You will sign in with it, and we will then email you a link to finish — every time.
              </p>
              <SetPasswordForm token={token} email={email} />
            </>
          ) : (
            <>
              <h2 style={{ marginBottom: 6 }}>This link has expired</h2>
              <p className="muted" style={{ fontSize: 14 }}>
                Password links work once and last 30 minutes. Ask for another and use the newest one.
              </p>
              <Link href="/login?reset=1" className="btn primary">
                Send me a new link
              </Link>
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}
