/**
 * The action list — SW-003 and SW-006, the two the app exists for.
 *
 * Rendered against a mocked tRPC client rather than a server: `pnpm test` must pass with no
 * network and no keys, and what is worth asserting here is what the screen does with an answer,
 * not that the answer arrives.
 */
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";
import { SessionProvider } from "@/session";

// jest.mock is hoisted above these declarations, so the names it closes over must be
// `mock`-prefixed — that prefix is Jest's opt-out of its uninitialised-variable guard.
const mockRegistry = jest.fn();
const mockList = jest.fn();
const mockDecide = jest.fn();

jest.mock("@/api", () => ({
  trpc: {
    documents: {
      registry: { query: (...a: unknown[]) => mockRegistry(...a) },
      list: { query: (...a: unknown[]) => mockList(...a) },
      decide: { mutate: (...a: unknown[]) => mockDecide(...a) },
      republish: { mutate: jest.fn() },
    },
    auth: { logout: { mutate: jest.fn() } },
  },
  errorMessage: (e: unknown) => (e as Error).message,
  isUnauthorized: () => false,
  API_URL: "http://localhost:3000",
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useFocusEffect: () => {},
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

import Actions from "./actions";

/**
 * The screens read safe-area insets, which come from a provider the real app mounts in
 * app/_layout.tsx. Tests mount their own with fixed metrics — a phone-shaped frame, so the
 * numbers are stable rather than whatever the host happens to report.
 */
const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * `render` is asynchronous in react-native-testing-library v14, so every call is awaited.
 *
 * The two providers app/_layout.tsx mounts. The session comes from the mocked keychain in
 * jest.setup.js, so the screen behaves as it does for a signed-in phone.
 */
const show = () =>
  render(<Actions />, {
    wrapper: ({ children }) => (
      <SafeAreaProvider initialMetrics={METRICS}>
        <SessionProvider>{children}</SessionProvider>
      </SafeAreaProvider>
    ),
  });

const TODAY = "2026-09-14";

const emptyRegistry = {
  today: TODAY,
  actions: [],
  events: [],
  meetings: [],
  inbox: [],
  doneRecently: [],
  meetingRequests: [],
};

const task = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  text: "Call the dentist",
  due: null,
  dueTime: null,
  priority: "normal",
  kind: "action",
  project: null,
  people: [],
  confidence: 1,
  source: { notebook: "Daily", pageIndex: 2, pageDate: null },
  carriedCount: 0,
  createdOn: TODAY,
  status: "open",
  sourceConvention: null,
  lastAgedOn: TODAY,
  completedOn: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue({ run: null, documents: [], pendingDelivery: null });
  mockDecide.mockResolvedValue({ label: "done", status: "done", created: 0 });
});

describe("the action list", () => {
  it("shows what is open, where it came from, and when it is due", async () => {
    mockRegistry.mockResolvedValue({ ...emptyRegistry, actions: [task({ due: "2026-09-15" })] });
    const s = await show();
    expect(await s.findByText("Call the dentist")).toBeTruthy();
    // Provenance counts pages from one, the way a person does.
    expect(s.getByText(/DAILY · p\.3/)).toBeTruthy();
    expect(s.getByText("TOMORROW")).toBeTruthy();
  });

  it("ticks an item off with one tap", async () => {
    mockRegistry.mockResolvedValue({ ...emptyRegistry, actions: [task()] });
    const s = await show();
    await fireEvent.press(await s.findByLabelText("Mark done: Call the dentist"));
    await waitFor(() => expect(mockDecide).toHaveBeenCalledWith({ itemType: "task", itemId: "t1", action: "complete" }));
    // Exactly once: a second tap while the first is in flight must not close it twice.
    expect(mockDecide).toHaveBeenCalledTimes(1);
  });

  it("says the Inbox is dayMarkable being unsure, not a list of things to do (rule 3)", async () => {
    mockRegistry.mockResolvedValue({
      ...emptyRegistry,
      inbox: [{ id: "i1", kind: "task", text: "Ring Kolb?", detail: null, confidence: 0.4, source: { notebook: "Daily", pageIndex: 0 }, status: "pending", payload: {}, createdOn: TODAY }],
    });
    const s = await show();
    expect(await s.findByText(/unsure it read these correctly/)).toBeTruthy();
    await fireEvent.press(s.getByLabelText("Not relevant: Ring Kolb?"));
    await waitFor(() => expect(mockDecide).toHaveBeenCalledWith({ itemType: "inbox", itemId: "i1", action: "drop" }));
  });

  it("says nothing is open rather than showing an empty card", async () => {
    mockRegistry.mockResolvedValue(emptyRegistry);
    const s = await show();
    expect(await s.findByText(/Nothing open/)).toBeTruthy();
  });

  it("offers to send the notebooks only once an edit has left the tablet behind", async () => {
    mockRegistry.mockResolvedValue(emptyRegistry);
    const quiet = await show();
    await quiet.findByText(/Nothing open/);
    expect(quiet.queryByText(/Your notebooks have changed/)).toBeNull();
    await quiet.unmount();

    mockList.mockResolvedValue({ run: null, documents: [], pendingDelivery: "2026-09-14T10:00:00.000Z" });
    const pending = await show();
    expect(await pending.findByText(/Your notebooks have changed/)).toBeTruthy();
    // The pages arrive when the reMarkable next syncs, and the copy must not imply otherwise.
    expect(pending.getByText(/still has the copies from the last run/)).toBeTruthy();
  });
});
