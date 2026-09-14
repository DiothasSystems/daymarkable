/**
 * How well did it read your handwriting, and what do you want changed (SW-007).
 *
 * Two separate things sharing a card. The rating is per run and feeds the admin portal's quality
 * metrics; the message is a request, kept verbatim. The admin side shows ratings and comments
 * only — never note content (rule 13) — so nothing here should ever be tempted to attach an item
 * to "give context".
 */
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { errorMessage, trpc } from "@/api";
import { Choice, TextField } from "./fields";
import { Button, Card, Label } from "./ui";
import { TOUCH_TARGET, color, font, space, type } from "@/theme";

type Kind = "feature" | "document_format" | "bug" | "other";

const KINDS: readonly { value: Kind; label: string }[] = [
  { value: "bug", label: "Something is wrong" },
  { value: "feature", label: "I want a feature" },
  { value: "document_format", label: "Page layout" },
  { value: "other", label: "Other" },
];

export function Feedback({ runId }: { runId: string | null }) {
  const [rating, setRating] = useState<number | null>(null);
  const [rated, setRated] = useState(false);
  const [kind, setKind] = useState<Kind>("bug");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rate = useCallback(
    async (stars: number) => {
      setRating(stars);
      setError(null);
      try {
        await trpc.feedback.rate.mutate({ runId, rating: stars, comment: null });
        setRated(true);
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    [runId],
  );

  const send = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await trpc.requests.submit.mutate({ kind, body });
      setSent(true);
      setBody("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [kind, body]);

  return (
    <Card>
      <Label style={{ marginBottom: space.xs }}>HOW WELL DID IT READ YOUR WRITING?</Label>
      <View style={{ flexDirection: "row", marginBottom: space.md }} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            onPress={() => void rate(n)}
            accessibilityRole="radio"
            accessibilityState={{ selected: rating === n }}
            accessibilityLabel={`${n} out of 5`}
            style={({ pressed }) => ({ width: TOUCH_TARGET, height: TOUCH_TARGET, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.5 : 1 })}
          >
            <Text style={{ fontSize: 24, color: rating !== null && n <= rating ? color.gold : color.borderStrong }}>★</Text>
          </Pressable>
        ))}
      </View>
      {rated ? <Text style={[type.small, { marginBottom: space.md }]}>Noted — thank you. Low scores are what we tune against.</Text> : null}

      <Label style={{ marginBottom: space.xs }}>TELL US SOMETHING</Label>
      <View style={{ marginBottom: space.sm }}>
        <Choice<Kind> label="What kind of message" value={kind} options={KINDS} onChange={setKind} />
      </View>
      <TextField
        label="Your message"
        value={body}
        onChange={(v) => {
          setBody(v);
          setSent(false);
        }}
        placeholder="A sentence or two is plenty."
        multiline
        minHeight={90}
      />
      {error ? <Text style={[type.small, { color: color.bad, marginTop: space.xs }]}>{error}</Text> : null}
      {sent ? (
        <Text style={[type.small, { color: color.goldText, marginTop: space.xs, fontFamily: font.sansBold }]} accessibilityLiveRegion="polite">
          Sent. We read all of them.
        </Text>
      ) : null}
      <View style={{ marginTop: space.sm }}>
        <Button title="Send" variant="secondary" busy={busy} onPress={() => void send()} />
      </View>
    </Card>
  );
}
