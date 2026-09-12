/**
 * One place to put an address into its canonical form, so the sign-in guard, the waiting list and
 * the users table all agree on what "the same address" means. Lives outside the server modules
 * because both auth and the waiting list need it and neither should have to import the other.
 */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
