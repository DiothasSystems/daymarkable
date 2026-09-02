import { DateTime } from "luxon";

export function fmtDate(iso: string | null | undefined, zone?: string): string {
  if (!iso) return "—";
  const d = DateTime.fromISO(iso, zone ? { zone } : {});
  return d.isValid ? d.toFormat("ccc d LLL") : iso;
}

export function fmtDateTime(d: Date | string | null | undefined, zone?: string): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? DateTime.fromISO(d) : DateTime.fromJSDate(d);
  const z = zone ? dt.setZone(zone) : dt;
  return z.isValid ? z.toFormat("ccc d LLL · HH:mm") : String(d);
}

export function fmtRelative(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? DateTime.fromISO(d) : DateTime.fromJSDate(d);
  return dt.toRelative() ?? "—";
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(n < 0.1 ? 4 : 2)}`;
}
