/** TEMPORARY — validation tool, delete this whole folder when calibration is signed off. */
import "server-only";

/**
 * Off unless the host asks for it. A default-on preview would let anyone with a session spend
 * API money a passage at a time, and would outlive the validation it was built for.
 */
export function previewEnabled(): boolean {
  return process.env.SETUP_PREVIEW === "1";
}
