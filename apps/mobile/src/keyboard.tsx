/**
 * Keeping what is being typed into above the keyboard, on every screen that has a text box.
 *
 * Android draws edge to edge now, so the window no longer shrinks when the keyboard opens and
 * KeyboardAvoidingView has nothing to react to: the keyboard simply covers the lower half of the
 * screen, which on a form is where the box being typed in usually is. Found on the sign-in screen
 * (which carries its own copy of this), then everywhere else that types.
 *
 * Two pieces:
 *   - `KeyboardAwareScrollView` replaces a screen's ScrollView. It pads its content by the keyboard's
 *     height, so there is something to scroll into, and on request scrolls the focused field to just
 *     above the keyboard.
 *   - `useRevealOnFocus` is what a field calls when it gains focus. The form controls in
 *     components/fields.tsx call it already, so a screen built from them needs nothing else.
 *
 * `useKeyboardHeight` is for a screen with no ScrollView of its own to scroll — the WebView pane —
 * which shrinks itself instead and lets the page scroll its own field into view.
 *
 * iOS resizes nothing either, but KeyboardAvoidingView works there, so iOS keeps that and this only
 * pads and scrolls on Android.
 */
import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, ScrollView, TextInput, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewProps } from "react-native";

/** How much clear space to leave between the field and the top of the keyboard. */
const GAP = 24;

const RevealContext = createContext<(() => void) | null>(null);

/** Call from a text field's onFocus. Outside a KeyboardAwareScrollView it does nothing. */
export function useRevealOnFocus(): () => void {
  const reveal = useContext(RevealContext);
  return useCallback(() => {
    // After focus has moved and the keyboard has had a moment to rise.
    if (reveal) setTimeout(reveal, 120);
  }, [reveal]);
}

/** The keyboard's height while it is up on Android, else 0. */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

export const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps & { children: ReactNode }>(function KeyboardAwareScrollView(
  { contentContainerStyle, onScroll, children, ...rest },
  ref,
) {
  const scroll = useRef<ScrollView>(null);
  useImperativeHandle(ref, () => scroll.current as ScrollView);
  const offset = useRef(0);
  /** Where the keyboard's top edge is, in window coordinates, while it is up. */
  const keyboardTop = useRef<number | null>(null);
  const [pad, setPad] = useState(0);

  const reveal = useCallback(() => {
    const top = keyboardTop.current;
    const field = TextInput.State.currentlyFocusedInput() as unknown as { measureInWindow?(cb: (x: number, y: number, w: number, h: number) => void): void } | null;
    if (top === null || !field?.measureInWindow) return;
    field.measureInWindow((_x, y, _w, h) => {
      const hidden = y + h + GAP - top;
      if (hidden > 0) scroll.current?.scrollTo({ y: offset.current + hidden, animated: true });
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      keyboardTop.current = e.endCoordinates.screenY;
      setPad(e.endCoordinates.height);
      // Once the padding is laid out, or there is nothing yet to scroll into.
      setTimeout(reveal, 60);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardTop.current = null;
      setPad(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [reveal]);

  const tracked = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
    onScroll?.(e);
  };

  return (
    <RevealContext.Provider value={reveal}>
      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        {...rest}
        onScroll={tracked}
        contentContainerStyle={[contentContainerStyle, pad ? { paddingBottom: pad + GAP } : null]}
      >
        {children}
      </ScrollView>
    </RevealContext.Provider>
  );
});
