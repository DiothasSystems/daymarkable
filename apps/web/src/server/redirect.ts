import "server-only";

/**
 * Redirect back to a path on the same host, as a RELATIVE Location header.
 *
 * `Response.redirect(new URL(path, req.url))` looks right and is wrong behind a proxy: inside the
 * container `req.url` is `http://127.0.0.1:3000/...`, so the browser is sent to localhost and the
 * page goes nowhere — even though the POST it was answering succeeded. A relative Location (valid
 * per RFC 7231 §7.1.2) is resolved by the browser against the address bar, so it lands on
 * daymarkable.com or app.daymarkable.com without this code needing to know which.
 *
 * Use `publicUrl()` / `serviceUrl()` instead only when crossing between the two hosts.
 */
export function seeOther(path: string): Response {
  if (!path.startsWith("/")) throw new Error(`seeOther needs a path, got "${path.slice(0, 40)}"`);
  return new Response(null, { status: 303, headers: { location: path } });
}
