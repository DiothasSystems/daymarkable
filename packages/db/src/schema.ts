/**
 * dayMarkable Postgres schema (Drizzle). Phase 0 is single-tenant but every row is keyed by
 * user_id so Phase 2 needs no migration of shape.
 *
 * Privacy (CLAUDE.md rule 5): page images, downloads, transcriptions, and generated PDFs live
 * ONLY in the 1-day run cache, never here. This database keeps the retained working set
 * (tasks, events, meeting notes, meeting requests) plus hashes, counts, and costs. Meeting note
 * bodies and device tokens are stored encrypted (see crypto.ts).
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const accountStatus = pgEnum("account_status", ["trial", "active", "past_due", "canceled", "deleted"]);
export const runKind = pgEnum("run_kind", ["nightly", "on_demand"]);
export const runStatus = pgEnum("run_status", ["queued", "running", "succeeded", "failed", "skipped"]);
export const taskStatus = pgEnum("task_status", ["open", "carried", "done", "dropped"]);
export const taskPriority = pgEnum("task_priority", ["high", "normal", "low"]);
export const taskKind = pgEnum("task_kind", ["action", "follow_up"]);
export const eventStatus = pgEnum("event_status", ["active", "dropped"]);
export const eventSource = pgEnum("event_source", ["ink", "external"]);
export const meetingRequestState = pgEnum("meeting_request_state", ["drafted", "confirmed", "sent", "dropped"]);
export const inboxKind = pgEnum("inbox_kind", ["task", "event", "meeting_request", "margin_note"]);
export const inboxStatus = pgEnum("inbox_status", ["pending", "accepted", "dropped", "expired"]);
export const documentKind = pgEnum("document_kind", ["planner", "action_list", "meeting_notes"]);
export const printedItemType = pgEnum("printed_item_type", ["task", "inbox", "meeting_request"]);
export const emailStatus = pgEnum("email_status", ["sent", "failed", "skipped"]);

/** Per-user settings blob (validated in code; shape versioned by `version`). */
export interface UserSettings {
  version: 1;
  /** Tablet folder paths to read; empty = all notebooks (ebooks/PDFs excluded by default). */
  watchFolders: string[];
  includePdfs: boolean;
  /** UserInkConventions from @daymarkable/decode. */
  conventions: { active: Array<{ id: string; meaning: string; keyword?: string }> };
  email: { meetingNotes: boolean; runSummary: boolean; inviteConfirmations: boolean };
  confidenceThreshold: number;
  autoSendInvites: boolean;
  /** Decode model config for this user (null = global default from env). */
  decodeModel: string | null;
  escalationModel: string | null;
}

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  timezone: text("timezone").notNull().default("America/New_York"),
  status: accountStatus("status").notNull().default("trial"),
  settings: jsonb("settings").$type<UserSettings>().notNull(),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tabletCredentials = pgTable("tablet_credentials", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("remarkable_cloud"),
  /** AES-256-GCM sealed device token (crypto.ts). */
  deviceTokenEnc: text("device_token_enc").notNull(),
  pairedAt: timestamp("paired_at", { withTimezone: true }).notNull().defaultNow(),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  lastError: text("last_error"),
});

export interface RunStats {
  docsSeen: number;
  docsChanged: number;
  pagesChanged: number;
  pagesRendered: number;
  pagesDecoded: number;
  pagesFailed: number;
  tasksFound: number;
  eventsFound: number;
  meetingRequestsFound: number;
  meetingsFound: number;
  checkboxUpdates: number;
  inboxItems: number;
  emailsSent: number;
  purgedRunId: string | null;
  purgedFiles: number;
  purgedBytes: number;
  costUsd: number;
}

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    kind: runKind("kind").notNull(),
    /** 0 for nightly; 1..n for on-demand syncs that day (rule 11 keys). */
    seq: integer("seq").notNull().default(0),
    status: runStatus("status").notNull().default("queued"),
    /** Which surface requested an on-demand run ("web", "mobile", "cli"). */
    requestedVia: text("requested_via"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    stats: jsonb("stats").$type<RunStats>(),
    /** Cache location for this run's downloads/images/outputs (deleted by the NEXT run). */
    cacheDir: text("cache_dir"),
    cachePurgedAt: timestamp("cache_purged_at", { withTimezone: true }),
    decodeModel: text("decode_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("runs_user_date_kind_seq").on(t.userId, t.localDate, t.kind, t.seq), index("runs_user_created").on(t.userId, t.createdAt)],
);

export const runCosts = pgTable(
  "run_costs",
  {
    id: serial("id").primaryKey(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    stage: text("stage").notNull(),
    model: text("model").notNull(),
    mode: text("mode").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    pages: integer("pages").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("run_costs_user_created").on(t.userId, t.createdAt)],
);

export const docSnapshots = pgTable(
  "doc_snapshots",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    docId: text("doc_id").notNull(),
    hash: text("hash").notNull(),
    name: text("name").notNull(),
    path: text("path").notNull(),
    fileType: text("file_type").notNull(),
    lastModified: timestamp("last_modified", { withTimezone: true }),
    pageCount: integer("page_count").notNull().default(0),
    lastRunId: uuid("last_run_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.docId] })],
);

export const pageSnapshots = pgTable(
  "page_snapshots",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    docId: text("doc_id").notNull(),
    pageId: text("page_id").notNull(),
    pageIndex: integer("page_index").notNull(),
    /** Stroke-file hash last processed; null = page had no ink. */
    hash: text("hash"),
    lastDecodedRunId: uuid("last_decoded_run_id"),
    pageKind: text("page_kind"),
    confidence: real("confidence"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.docId, t.pageId] })],
);

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    due: date("due"),
    dueTime: text("due_time"),
    priority: taskPriority("priority").notNull().default("normal"),
    kind: taskKind("kind").notNull().default("action"),
    project: text("project"),
    people: jsonb("people").$type<string[]>().notNull().default([]),
    confidence: real("confidence").notNull(),
    sourceConvention: text("source_convention"),
    sourceNotebook: text("source_notebook"),
    sourcePageIndex: integer("source_page_index"),
    status: taskStatus("status").notNull().default("open"),
    carriedCount: integer("carried_count").notNull().default(0),
    lastAgedOn: date("last_aged_on"),
    createdOn: date("created_on").notNull(),
    completedOn: date("completed_on"),
    createdRunId: uuid("created_run_id"),
    updatedRunId: uuid("updated_run_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tasks_user_status").on(t.userId, t.status)],
);

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    date: date("date"),
    startTime: text("start_time"),
    endTime: text("end_time"),
    location: text("location"),
    people: jsonb("people").$type<string[]>().notNull().default([]),
    source: eventSource("source").notNull().default("ink"),
    confidence: real("confidence").notNull(),
    status: eventStatus("status").notNull().default("active"),
    createdRunId: uuid("created_run_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("events_user_date").on(t.userId, t.date)],
);

export const meetings = pgTable(
  "meetings",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    date: date("date"),
    time: text("time"),
    attendees: jsonb("attendees").$type<string[]>().notNull().default([]),
    /** Encrypted JSON: { text: string; decisions: string[]; actions: string[] } (crypto.ts). */
    bodyEnc: text("body_enc").notNull(),
    confidence: real("confidence").notNull(),
    sourceNotebook: text("source_notebook"),
    sourcePageIndex: integer("source_page_index"),
    createdRunId: uuid("created_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meetings_user_date").on(t.userId, t.date)],
);

export const meetingRequests = pgTable(
  "meeting_requests",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    proposedDate: date("proposed_date"),
    proposedTime: text("proposed_time"),
    durationMinutes: integer("duration_minutes"),
    attendees: jsonb("attendees").$type<string[]>().notNull().default([]),
    confidence: real("confidence").notNull(),
    state: meetingRequestState("state").notNull().default("drafted"),
    confirmedOn: date("confirmed_on"),
    createdRunId: uuid("created_run_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meeting_requests_user_state").on(t.userId, t.state)],
);

export const inboxItems = pgTable(
  "inbox_items",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: inboxKind("kind").notNull(),
    text: text("text").notNull(),
    detail: text("detail"),
    confidence: real("confidence").notNull(),
    /** The original extracted item, promoted verbatim when the user ticks the box. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: inboxStatus("status").notNull().default("pending"),
    sourceNotebook: text("source_notebook"),
    sourcePageIndex: integer("source_page_index"),
    createdOn: date("created_on").notNull(),
    createdRunId: uuid("created_run_id"),
    resolvedRunId: uuid("resolved_run_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inbox_user_status").on(t.userId, t.status)],
);

/** What each planner page printed: page code + item code -> the item, so ticks resolve deterministically. */
export const printedItems = pgTable(
  "printed_items",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    pageCode: text("page_code").notNull(),
    itemCode: text("item_code").notNull(),
    itemType: printedItemType("item_type").notNull(),
    itemId: text("item_id").notNull(),
  },
  (t) => [uniqueIndex("printed_items_page_item").on(t.userId, t.pageCode, t.itemCode, t.runId)],
);

/** Registry of generated outputs the viewers serve from the 1-day cache (rule 12). */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    kind: documentKind("kind").notNull(),
    name: text("name").notNull(),
    /** Path inside the run cache (encrypted file). */
    cachePath: text("cache_path").notNull(),
    bytes: integer("bytes").notNull(),
    pageCount: integer("page_count").notNull(),
    tabletDocId: text("tablet_doc_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("documents_user_created").on(t.userId, t.createdAt)],
);

export const emailLog = pgTable("email_log", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  runId: uuid("run_id"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  status: emailStatus("status").notNull(),
  providerId: text("provider_id"),
  error: text("error"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feedback = pgTable(
  "feedback",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("feedback_user_created").on(t.userId, t.createdAt)],
);

/** Magic-link login tokens (Milestone 3). */
export const loginTokens = pgTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only (Milestone 4). No update/delete path exists in code. */
export const adminAudit = pgTable("admin_audit", {
  id: serial("id").primaryKey(),
  adminLoginId: text("admin_login_id").notNull(),
  action: text("action").notNull(),
  targetUserId: uuid("target_user_id"),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminLoginAttempts = pgTable("admin_login_attempts", {
  id: serial("id").primaryKey(),
  ip: text("ip").notNull(),
  success: boolean("success").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
