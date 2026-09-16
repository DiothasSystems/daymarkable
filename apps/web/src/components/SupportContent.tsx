import Link from "next/link";
import { FeatureRequestForm } from "./FeatureRequestForm";

/**
 * The support content, written once and rendered on both hosts.
 *
 * The public site and the signed-in service need the same answers, and an answer that exists in
 * two places drifts. `appBase` is what makes it portable: empty inside the service so links stay
 * relative, and the absolute service URL on the public site, where /account is on another host.
 */
export interface SupportContentProps {
  /** "" inside the app; `serviceUrl()` on the marketing host. */
  appBase: string;
  supportEmail: string | null;
  /** The feature-request form needs a session, so it only appears inside the service. */
  signedIn: boolean;
}

export function SupportContent({ appBase, supportEmail, signedIn }: SupportContentProps) {
  const app = (path: string) => `${appBase}${path}`;
  return (
    <>
      <h2 id="accuracy">How can I improve how well my writing is read?</h2>
      <p>
        Four things, in the order they are worth doing. The first two take ten minutes once; the rest are habits.
      </p>
      <ol>
        <li>
          <strong>Write the calibration sample.</strong> It is a short passage in the vocabulary of your own job, and
          the page you write becomes the reference the decoder reads your letterforms against. Start it from{" "}
          <a href={app("/account")}>your account page</a>, or run through <a href={app("/setup")}>setup</a> again — you
          can redo it any time, and a fresh sample replaces the old one.
        </li>
        <li>
          <strong>Fill in your key terms.</strong> Names, companies, products, standards, the acronyms your field uses.
          Proper nouns are where misreads concentrate, and this is the single largest improvement available. Same place:
          the vocabulary list on <a href={app("/account")}>your account page</a>.
        </li>
        <li>
          <strong>Register the marks you actually use.</strong> If an asterisk means an action to you, say so. If{" "}
          <span className="mono">&gt;</span> means put it on the calendar and <span className="mono">NB</span> means keep
          it as a note, add both. Your own markup is trusted over any guess at your wording, and only the marks you turn
          on carry meaning.
        </li>
        <li>
          <strong>Correct what comes back.</strong> On <a href={app("/documents")}>Documents</a>, click any decoded line
          to fix a misread. Corrections are not just cosmetic — recurring ones are promoted into your vocabulary list
          automatically, so the same word stops being wrong. Editing rebuilds your documents immediately; use{" "}
          <em>Send updated notebooks to tablet</em> to push the corrected versions across.
        </li>
      </ol>

      <h2 id="missing-files">My files are not on my tablet</h2>
      <p>Work down this list — the cause is almost always one of the first two.</p>
      <ol>
        <li>
          <strong>Check the tablet is paired.</strong> <a href={app("/account")}>Your account page</a> says so at the
          top. If pairing has lapsed, re-pair with a fresh code from my.remarkable.com — codes expire after a few
          minutes.
        </li>
        <li>
          <strong>Check the tablet has synced itself.</strong> dayMarkable writes to the reMarkable cloud, not to the
          device. The tablet has to be awake, on Wi-Fi, and synced before anything appears on it. On the charger
          overnight is the whole routine.
        </li>
        <li>
          <strong>Look at your documents online first.</strong> Open <a href={app("/documents")}>Documents</a> and check
          the Action items, Calendar and Notebooks tabs. If they look right there, the reading worked and the problem is
          delivery — press <em>Send updated notebooks to tablet</em>. It costs nothing and does not use a sync.
        </li>
        <li>
          <strong>If they look out of date, run a sync.</strong> <em>Sync now</em> on{" "}
          <a href={app("/today")}>Today</a> reads your pages immediately rather than waiting for tonight. Three per
          rolling 24 hours.
        </li>
        <li>
          <strong>Check whether a run failed.</strong> <a href={app("/runs")}>Runs</a> shows every night with its
          status and, if something went wrong, the reason. A failed night is never written half-finished.
        </li>
      </ol>

      <h2 id="templates">I added a planner template and nothing was read</h2>
      <p>
        Expected, once. The first sync after a document appears records the state of every page in
        it without reading any of them — that is what stops adding a notebook you have kept for
        years decoding all of it. Write on a page and sync again, and from then on your annotations
        are picked up exactly, because every page now has a recorded state to compare against.
      </p>
      <p>So adding a template takes two syncs to come alive. After that it is immediate.</p>
      <p>
        Two things worth knowing about templates specifically. Annotated PDFs are only read if{" "}
        <strong>Include annotated PDFs</strong> is on in <a href={app("/account")}>your settings</a>
        {" "}— it is off by default, because most PDFs on a reMarkable are books. And a page you have
        not written on costs nothing: it carries no ink layer, so a two-thousand-page planner kit is
        read as the handful of pages you actually marked up, not as two thousand pages.
      </p>

      <h2 id="cancel">How do I cancel?</h2>
      <p>
        On <a href={app("/account")}>your account page</a>, under <strong>Cancel subscription</strong>. It takes effect
        at the end of the period you have already paid for, so nothing is cut off early and nothing is charged again.
      </p>
      <p>
        Until then everything keeps working. Afterwards the nightly runs stop; the notebooks already on your tablet are
        yours and stay there, because they are ordinary reMarkable documents. Your page images and generated files were
        never kept longer than 24 hours anyway. If you would rather we deleted the decoded items too, ask and we will.
      </p>

      <h2 id="requests">How do I request a feature or a document format?</h2>
      <p>
        Ask directly — the form below reaches us, and dayMarkable is early enough that what gets built is largely
        decided by what people ask for. Page layouts and new document formats are the most common request and among the
        easiest to act on, so be specific: what you want on the page, and what you are doing with it.
      </p>
      {signedIn ? (
        <FeatureRequestForm />
      ) : (
        <p>
          <a href={app("/support")}>Sign in and open Support</a> to send one, or write to{" "}
          {supportEmail ? <a href={`mailto:${supportEmail}`}>{supportEmail}</a> : "us"} instead.
        </p>
      )}

      <h2 id="pairing">Pairing and timing</h2>
      <ul>
        <li>
          Pairing codes come from my.remarkable.com/device/browser/connect and last a few minutes. Generate a fresh one
          if it is rejected.
        </li>
        <li>
          Everything you write during the day is read once the date turns over, a minute after midnight in your
          timezone. A page written after that run waits for the next one.
        </li>
        <li>
          Travelling does not move your run — it stays on the timezone set on your account. Use <em>Sync now</em> while
          you are away, or change the timezone if you have moved for good.
        </li>
        <li>
          If a night is skipped with a sync error, the reMarkable cloud format has usually changed. We watch for it
          closely, and a broken planner is never written.
        </li>
      </ul>

      <h2 id="email">Email and delivery</h2>
      <ul>
        <li>Meeting-note emails go to the address you signed in with. Turn them off under Email on your account page.</li>
        <li>
          A delivery address receives PDFs only after someone clicks the confirmation link sent to it. That is
          deliberate: a typo would otherwise mail your notes to a stranger every night. Check spam, then resend from
          settings.
        </li>
      </ul>

      <h2 id="privacy">What happens to my notes</h2>
      <p>
        Page images and generated files live at most 24 hours: each run keeps its own and deletes the previous night&apos;s
        as its last step. Decoded items — your tasks, events and notes — are kept encrypted, because the action list has
        to survive to tomorrow. Nothing you write appears in a log. Ratings and comments reach us; note content does
        not. <Link href="/privacy">Full privacy policy</Link>.
      </p>

      <h2 id="contact">Still stuck</h2>
      <p>
        {supportEmail ? (
          <>
            Write to <a href={`mailto:${supportEmail}`}>{supportEmail}</a> from the address you signed in with, and say
            which night and which notebook.
          </>
        ) : (
          <>
            Reply to any email dayMarkable has sent you — a sign-in link, a meeting summary, a delivery confirmation —
            and a person reads it. Say which night and which notebook.
          </>
        )}
      </p>
    </>
  );
}
