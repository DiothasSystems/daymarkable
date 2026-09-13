/**
 * TEMPORARY — validation tool, delete this whole folder when calibration is signed off.
 *
 * Generates a calibration passage and composes its sheet for an arbitrary writer profile,
 * WITHOUT pairing a tablet. Nothing here writes to the database, uploads to the reMarkable
 * cloud, or touches the signed-in user's own calibration or lexicon: the real
 * `createCalibrationSheet` does all four, and step 0 of the setup wizard blocks the way to it
 * until a tablet is paired, which is what makes the flow impossible to eyeball.
 */
"use server";
import { composeCalibrationSheet } from "@daymarkable/compose";
import { anthropicClient, generateCalibrationPassage } from "@daymarkable/decode";
import { DateTime } from "luxon";
import { getSessionUser } from "@/server/auth";
import { getRuntime } from "@/server/runtime";
import { previewEnabled } from "./enabled";

export interface PassagePreview {
  text: string;
  terms: string[];
  /** Null when the model answered; the reason the generic fallback was substituted otherwise. */
  fallbackReason: string | null;
  stopReason: string | null;
  model: string;
  outputTokens: number;
  costUsd: number;
  lines: number;
  longestLine: number;
  /** The composed sheet as it would reach the tablet, base64 so the page can show it inline. */
  pdfBase64: string;
  error?: string;
}

export async function previewPassage(profile: { role: string; industry: string; context: string }): Promise<PassagePreview | { error: string }> {
  if (!previewEnabled()) return { error: "This preview is not enabled on this host." };
  // It spends real API money, so it stays behind a session even though it reads nothing personal.
  if (!(await getSessionUser())) return { error: "Sign in first." };

  const rt = await getRuntime();
  if (!rt.config.anthropicApiKey) return { error: "ANTHROPIC_API_KEY is not configured on this host." };

  const trimmed = { role: profile.role.slice(0, 120), industry: profile.industry.slice(0, 120), context: profile.context.slice(0, 600) };
  if (!trimmed.role.trim() && !trimmed.industry.trim()) return { error: "Give a role or an industry." };

  const passage = await generateCalibrationPassage(trimmed, anthropicClient(rt.config.anthropicApiKey), rt.config.decodeModel);
  const today = DateTime.now().setZone(rt.config.timezone);
  const sheet = await composeCalibrationSheet({ text: passage.text, date: today.toISODate()!, generatedAt: today.toISO()! });
  const lines = passage.text.split("\n");

  return {
    text: passage.text,
    terms: passage.terms,
    fallbackReason: passage.fallbackReason,
    stopReason: passage.stopReason,
    model: rt.config.decodeModel,
    outputTokens: passage.usage.output_tokens,
    costUsd: passage.costUsd,
    lines: lines.length,
    longestLine: Math.max(...lines.map((l) => l.length)),
    pdfBase64: Buffer.from(sheet.pdf).toString("base64"),
  };
}
