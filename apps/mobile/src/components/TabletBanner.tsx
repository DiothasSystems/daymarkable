/**
 * "Your notebooks have changed. Send them to your tablet."
 *
 * Ticking an item off changes the canonical lists straight away, and the server rebuilds the
 * notebooks locally and stamps `pendingDelivery` — but the copies already ON the tablet are the
 * printed ones, and they stay that way until someone asks. This is the asking.
 *
 * Three properties make it safe to show as often as it appears (docs/MOBILE_PLAN.md §6):
 * composing calls no model, so it is free; republish does not touch the 3-per-24h sync quota,
 * which governs decode runs; and it is never automatic — five ticks make one prompt, one send.
 *
 * The last line matters and is easy to leave out: the pages appear when the reMarkable next
 * talks to the cloud, not the instant this succeeds.
 */
import { useState } from "react";
import { Text, View } from "react-native";
import { errorMessage, trpc } from "@/api";
import { color, font, space, type } from "@/theme";
import { Button } from "./ui";

export function TabletBanner({ pendingSince, onSent }: { pendingSince: string | null; onSent(): void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  if (!pendingSince && !message) return null;

  async function send() {
    setBusy(true);
    setFailed(false);
    try {
      const r = await trpc.documents.republish.mutate();
      setMessage(`Sent ${r.uploaded.join(", ")} — ${r.openActions} open actions, ${r.meetings} meetings. Sync the reMarkable to see them.`);
      onSent();
    } catch (err) {
      setMessage(errorMessage(err));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={{
        backgroundColor: color.sunrise,
        borderColor: color.borderStrong,
        borderWidth: 1,
        borderRadius: 6,
        padding: space.md,
        marginHorizontal: space.lg,
        marginBottom: space.md,
        gap: space.sm,
      }}
      accessibilityLiveRegion="polite"
    >
      {message ? (
        <Text style={[type.small, { color: failed ? color.bad : color.midnight }]}>{message}</Text>
      ) : (
        <>
          <Text style={[type.body, { fontFamily: font.sansBold }]}>Your notebooks have changed.</Text>
          <Text style={type.small}>The tablet still has the copies from the last run.</Text>
          <Button title="Send to my tablet" onPress={() => void send()} busy={busy} variant="secondary" />
        </>
      )}
    </View>
  );
}
