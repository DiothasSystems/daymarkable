/** Compose a Daily Sheet from a fixture model (no network) so the layout can be eyeballed. */
import { writeFile } from "node:fs/promises";
import { composeDailySheet } from "@daymarkable/compose";
import type { DailySheetModel } from "@daymarkable/core";

const src = { notebook: "Sample", pageIndex: 0 };
const model: DailySheetModel = {
  date: "2026-09-02",
  timezone: "America/New_York",
  generatedAt: "2026-09-02T03:04:00-04:00",
  runLabel: "nightly",
  events: [
    { id: "e1", title: "Dentist", date: "2026-09-02", startTime: "14:00", endTime: "15:00", location: "Main St", people: [], source: "ink", confidence: 0.9 },
    { id: "e2", title: "Stand-up", date: "2026-09-02", startTime: "09:30", endTime: null, location: null, people: [], source: "ink", confidence: 0.9 },
    { id: "e3", title: "Pay estimated taxes", date: "2026-09-02", startTime: null, endTime: null, location: null, people: [], source: "ink", confidence: 0.9 },
  ],
  upcoming: [{ id: "e4", title: "Board meeting", date: "2026-09-05", startTime: "09:00", endTime: null, location: null, people: [], source: "ink", confidence: 0.9 }],
  actions: [
    { id: "a1", text: "Call Steve about the Q4 forecast and the reMarkable integration timeline", due: "2026-09-08", dueTime: "14:00", priority: "high", kind: "action", project: "dayMarkable", people: ["Steve"], confidence: 0.95, source: src, carriedCount: 0, createdOn: "2026-09-02" },
    { id: "a2", text: "Renew passport", due: null, dueTime: null, priority: "normal", kind: "action", project: null, people: [], confidence: 0.9, source: src, carriedCount: 3, createdOn: "2026-08-30" },
    { id: "a3", text: "Chase Priya for the budget spreadsheet", due: "2026-09-03", dueTime: null, priority: "normal", kind: "follow_up", project: null, people: ["Priya"], confidence: 0.88, source: src, carriedCount: 1, createdOn: "2026-09-01" },
    { id: "a4", text: "Buy milk", due: null, dueTime: null, priority: "low", kind: "action", project: null, people: [], confidence: 0.9, source: src, carriedCount: 0, createdOn: "2026-09-02" },
  ],
  inbox: [
    { id: "i1", kind: "task", text: "Book flights for Chicago (?)", detail: "due 2026-09-20", confidence: 0.55, source: src },
    { id: "i2", kind: "meeting_request", text: "Set up: 30 min with Priya", detail: "2026-09-09 with Priya", confidence: 0.6, source: src },
  ],
  meetingRequests: [
    { id: "m1", topic: "Roadmap sync", proposedDate: "2026-09-09", proposedTime: "10:00", durationMinutes: 30, attendees: ["Priya"], confidence: 0.85, source: src },
  ],
  stats: { pagesRead: 3, tasksFound: 6, eventsFound: 4, meetingRequestsFound: 2, notesFound: 1 },
};

const out = process.argv[2] ?? "sample-daily-sheet.pdf";
const pdf = await composeDailySheet(model);
await writeFile(out, pdf);
console.log(`wrote ${out} (${(pdf.length / 1024).toFixed(0)} KB)`);
