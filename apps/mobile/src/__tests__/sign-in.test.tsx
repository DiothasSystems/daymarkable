/**
 * The sign-in form: the eye that shows the password, and the way to a new password when it is
 * forgotten. Rendered against mocks, like actions.test.tsx, and kept out of app/ for the same reason.
 */
import { fireEvent, render } from "@testing-library/react-native";
import { SafeAreaProvider, type Metrics } from "react-native-safe-area-context";

const mockRequestPasswordLink = jest.fn();

jest.mock("@/api", () => ({
  trpc: {
    auth: {
      requestLink: { mutate: jest.fn() },
      requestPasswordLink: { mutate: (...a: unknown[]) => mockRequestPasswordLink(...a) },
      claim: { mutate: jest.fn() },
    },
  },
  errorMessage: (e: unknown) => (e as Error).message,
  siteUrl: () => "https://scriptumiq.com",
}));
jest.mock("@/session", () => ({ useSession: () => ({ signIn: jest.fn() }) }));
jest.mock("@/components/Hero", () => ({ Hero: () => null }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));

import SignIn from "../../app/sign-in";

const METRICS: Metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const show = () => render(<SignIn />, { wrapper: ({ children }) => <SafeAreaProvider initialMetrics={METRICS}>{children}</SafeAreaProvider> });

describe("the sign-in form", () => {
  it("hides the password until the eye is tapped, and hides it again on a second tap", async () => {
    const s = await show();
    const field = s.getByLabelText("Password");
    expect(field.props.secureTextEntry).toBe(true);
    await fireEvent.press(s.getByLabelText("Show password"));
    expect(s.getByLabelText("Password").props.secureTextEntry).toBe(false);
    await fireEvent.press(s.getByLabelText("Hide password"));
    expect(s.getByLabelText("Password").props.secureTextEntry).toBe(true);
  });

  it("offers Forgot password, which leads to the emailed link for a new one", async () => {
    mockRequestPasswordLink.mockResolvedValue({ ok: true });
    const s = await show();
    await fireEvent.changeText(s.getByLabelText("Email address"), "jim@example.com");
    await fireEvent.press(s.getByText("Forgot password?"));
    await fireEvent.press(s.getByText("Email me a link"));
    expect(mockRequestPasswordLink).toHaveBeenCalledWith({ email: "jim@example.com" });
    expect(await s.findByText(/a link to set your password is on its way/)).toBeTruthy();
  });
});
