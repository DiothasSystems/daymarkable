/**
 * The extraction schema (docs/ARCHITECTURE.md §4). ONE place, zod-validated, versioned.
 * The LLM fills this in; packages/core organizes it (CLAUDE.md rule 1).
 */
import { z } from "zod";

export const EXTRACTION_SCHEMA_VERSION = 1 as const;

const Confidence = z.number().min(0).max(1);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const HHMM = z.string().regex(/^\d{2}:\d{2}$/, "HH:MM");

export const TaskSchema = z.object({
  text: z.string().min(1),
  due: IsoDate.nullable(),
  due_time: HHMM.nullable(),
  priority: z.enum(["high", "normal", "low"]),
  kind: z.enum(["action", "follow_up"]),
  project: z.string().nullable(),
  people: z.array(z.string()),
  /** Which registered ink convention flagged it (id), or null if inferred from wording. */
  source_convention: z.string().nullable(),
  confidence: Confidence,
});
export type ExtractedTask = z.infer<typeof TaskSchema>;

export const EventSchema = z.object({
  title: z.string().min(1),
  date: IsoDate.nullable(),
  start_time: HHMM.nullable(),
  end_time: HHMM.nullable(),
  location: z.string().nullable(),
  people: z.array(z.string()),
  confidence: Confidence,
});
export type ExtractedEvent = z.infer<typeof EventSchema>;

export const MeetingRequestSchema = z.object({
  topic: z.string().min(1),
  proposed_date: IsoDate.nullable(),
  proposed_time: HHMM.nullable(),
  duration_minutes: z.number().int().positive().nullable(),
  attendees: z.array(z.string()),
  confidence: Confidence,
});
export type ExtractedMeetingRequest = z.infer<typeof MeetingRequestSchema>;

export const NoteSchema = z.object({
  /** Meeting/topic grouping; null for loose notes. */
  meeting_topic: z.string().nullable(),
  meeting_date: IsoDate.nullable(),
  meeting_time: HHMM.nullable(),
  attendees: z.array(z.string()),
  text: z.string(),
  decisions: z.array(z.string()),
  confidence: Confidence,
});
export type ExtractedNote = z.infer<typeof NoteSchema>;

export const CheckboxUpdateSchema = z.object({
  /** The item code printed beside the box on a dayMarkable page, e.g. "A03" or "I01". */
  item_code: z.string().nullable(),
  label: z.string(),
  checked: z.boolean(),
  /** Struck through = explicit drop. */
  struck: z.boolean(),
  margin_note: z.string().nullable(),
  /**
   * A date the user wrote by hand in the row's WHEN / PRIORITY field. dayMarkable never invents
   * a due date, so this is the only way a printed action acquires one.
   */
  written_due: IsoDate.nullable().default(null),
  /** A priority the user wrote in the same field ("!", "P1", "HIGH", "low"). */
  written_priority: z.enum(["high", "normal", "low"]).nullable().default(null),
  confidence: Confidence,
});
export type ExtractedCheckboxUpdate = z.infer<typeof CheckboxUpdateSchema>;

export const PageExtractionSchema = z.object({
  schema_version: z.literal(EXTRACTION_SCHEMA_VERSION),
  /** "planner" = one of dayMarkable's own pages (footer code present). */
  page_kind: z.enum(["notes", "planner", "blank", "other"]),
  /** Footer code when page_kind is planner, e.g. "dM/DAY/2026-09-02/1". */
  planner_page_code: z.string().nullable(),
  transcription: z.string(),
  tasks: z.array(TaskSchema),
  events: z.array(EventSchema),
  meeting_requests: z.array(MeetingRequestSchema),
  notes: z.array(NoteSchema),
  checkbox_updates: z.array(CheckboxUpdateSchema),
  overall_confidence: Confidence,
  /** Model self-report: legibility too poor for a confident read (triggers escalation). */
  needs_escalation: z.boolean(),
});
export type PageExtraction = z.infer<typeof PageExtractionSchema>;

export function emptyExtraction(kind: PageExtraction["page_kind"] = "blank"): PageExtraction {
  return {
    schema_version: EXTRACTION_SCHEMA_VERSION,
    page_kind: kind,
    planner_page_code: null,
    transcription: "",
    tasks: [],
    events: [],
    meeting_requests: [],
    notes: [],
    checkbox_updates: [],
    overall_confidence: 1,
    needs_escalation: false,
  };
}

/** A compact, model-facing description of the JSON we expect (kept next to the zod source of truth). */
export const SCHEMA_DESCRIPTION = `{
  "schema_version": 1,
  "page_kind": "notes" | "planner" | "blank" | "other",
  "planner_page_code": string | null,          // footer code on dayMarkable pages, else null
  "transcription": string,                     // faithful transcription, line breaks preserved
  "tasks": [{
    "text": string,
    "due": "YYYY-MM-DD" | null,                // ONLY if the entry itself states a deadline
    "due_time": "HH:MM" | null,
    "priority": "high" | "normal" | "low", "kind": "action" | "follow_up",
    "project": string | null, "people": string[],
    "source_convention": string | null,        // convention id that flagged it, or null
    "confidence": 0..1
  }],
  "events": [{ "title": string, "date": "YYYY-MM-DD" | null, "start_time": "HH:MM" | null,
               "end_time": "HH:MM" | null, "location": string | null, "people": string[], "confidence": 0..1 }],
  "meeting_requests": [{ "topic": string, "proposed_date": "YYYY-MM-DD" | null, "proposed_time": "HH:MM" | null,
               "duration_minutes": integer | null, "attendees": string[], "confidence": 0..1 }],
  "notes": [{ "meeting_topic": string | null, "meeting_date": "YYYY-MM-DD" | null, "meeting_time": "HH:MM" | null,
              "attendees": string[], "text": string, "decisions": string[], "confidence": 0..1 }],
  "checkbox_updates": [{ "item_code": string | null, "label": string, "checked": boolean, "struck": boolean,
              "margin_note": string | null,
              "written_due": "YYYY-MM-DD" | null,      // date HANDWRITTEN in the row's WHEN field
              "written_priority": "high" | "normal" | "low" | null,  // priority handwritten there
              "confidence": 0..1 }],
  "overall_confidence": 0..1,
  "needs_escalation": boolean
}`;
