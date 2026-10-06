/**
 * The tour is the web's storyboard, one scene per swipe. The tests hold the two things that are
 * easy to break without noticing on a phone: the keyframe shift that stands in for CSS's
 * animation-delay, and the screen's promise of every scene with a way to register on each.
 */
jest.mock("@/api", () => ({ API_URL: "https://app.scriptumiq.com", siteUrl: () => "https://scriptumiq.com" }));
jest.mock("expo-router", () => ({ useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }) }));
jest.mock("@/session", () => ({ useSession: () => ({ session: null }) }));

import { fireEvent, render, screen } from "@testing-library/react-native";
import { Animated } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Tour from "../../app/tour";
import { track } from "@/storyboard/motion";
import { SCENES } from "@/storyboard/scenes";

const POP = [[0, 0], [0.08, 0], [0.18, 1], [0.88, 1], [0.96, 0], [1, 0]] as const;

function sample(delay: number, at: number) {
  const clock = new Animated.Value(at);
  const v = track(clock, POP, delay) as unknown as { __getValue(): number };
  return v.__getValue();
}

describe("a motion started late", () => {
  it("is the same motion, shifted round the loop as animation-delay shifts it", () => {
    // No delay: hidden at the start, shown in the middle.
    expect(sample(0, 0)).toBe(0);
    expect(sample(0, 0.5)).toBe(1);
    // Two seconds late on an eight-second loop is a quarter of it: the middle moves a quarter on.
    expect(sample(2, 0.3)).toBe(0);
    expect(sample(2, 0.5)).toBe(1);
    expect(sample(2, 0.25 + 0.13)).toBeCloseTo(0.5);
  });

  it("wraps: a motion late enough to run past the end of the loop carries on at the start", () => {
    // Six seconds late: its visible stretch (18%–88%) runs from 93% of the loop round to 63%.
    expect(sample(6, 0.1)).toBe(1);
    expect(sample(6, 0.75)).toBe(0);
  });
});

describe("the tour", () => {
  const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

  // The loop never ends, so a test that let it run would never end either.
  beforeEach(() => {
    jest.spyOn(Animated, "loop").mockReturnValue({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() });
  });

  it("has every scene of the website's storyboard, in order, one per step, then the promises", async () => {
    // render is asynchronous in react-native-testing-library v14.
    await render(
      <SafeAreaProvider initialMetrics={metrics}>
        <Tour />
      </SafeAreaProvider>,
    );
    expect(SCENES).toHaveLength(14);
    expect(screen.getAllByRole("tab")).toHaveLength(SCENES.length + 1);
    expect(screen.getByText("Your invitation")).toBeTruthy();
    expect(screen.getByText("The loop closes")).toBeTruthy();
    expect(screen.getByLabelText("Step 15 of 15: What it never does")).toBeTruthy();
    expect(screen.getByText("Never logs what your notes say — counts and hashes only")).toBeTruthy();
    expect(screen.getByLabelText("Step 1 of 15: Your invitation").props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByText("Next"));
    expect(screen.getByLabelText("Step 2 of 15: Pair your tablet").props.accessibilityState).toMatchObject({ selected: true });
    // Someone signed out is asked to register, on every step.
    expect(screen.getByText("Register")).toBeTruthy();
  });
});
