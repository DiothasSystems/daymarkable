/**
 * Signing out has to LEAVE the signed-in screens.
 *
 * The bug this holds shut: clearing the session changed state that nothing on screen was watching,
 * because the only redirect lives in `app/index.tsx` and that has long since unmounted by the time
 * anyone is on a tab. Sign out therefore appeared to do nothing — the credential was gone and the
 * screen stayed exactly as it was.
 *
 * Asserting on `router.replace` rather than on a rendered screen is deliberate: the gate's whole
 * job is the navigation, and rendering the real tabs would drag in the API, the fonts and the
 * splash to prove a one-line decision.
 */
import { render, waitFor } from "@testing-library/react-native";
import { SessionGate } from "@/SessionGate";

const mockReplace = jest.fn();
const mockSegments = jest.fn();
const mockSession = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: (...a: unknown[]) => mockReplace(...a), push: jest.fn(), back: jest.fn() }),
  useSegments: () => mockSegments(),
}));

jest.mock("@/session", () => ({
  useSession: () => ({ session: mockSession(), signIn: jest.fn(), signOut: jest.fn() }),
}));

/** `session` is the stored credential: a string signed in, null signed out, undefined still loading. */
function show(session: string | null | undefined, segments: string[]) {
  mockSession.mockReturnValue(session);
  mockSegments.mockReturnValue(segments);
  return render(<SessionGate />);
}

describe("the session gate", () => {
  beforeEach(() => {
    mockReplace.mockClear();
  });

  it("sends a signed-out app back to sign-in from wherever it was", async () => {
    show(null, ["(tabs)", "more"]);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/sign-in"));
  });

  it("leaves while the session is still being read, so a cold start is not bounced", async () => {
    show(undefined, ["(tabs)", "actions"]);
    await waitFor(() => expect(mockReplace).not.toHaveBeenCalled());
  });

  it("stays put on the screens a signed-out person is allowed to be on", async () => {
    for (const where of [["sign-in"], ["tour"]]) {
      mockReplace.mockClear();
      show(null, where);
      await waitFor(() => expect(mockReplace).not.toHaveBeenCalled());
    }
  });

  it("does not move a signed-in app", async () => {
    show("a-session-id", ["(tabs)", "more"]);
    await waitFor(() => expect(mockReplace).not.toHaveBeenCalled());
  });

  it("redirects out of the WebView panes too, which hold a signed-in page", async () => {
    show(null, ["web", "[pane]"]);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/sign-in"));
  });
});
