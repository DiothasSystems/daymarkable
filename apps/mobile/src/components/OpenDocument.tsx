/**
 * Open one of the night's generated notebooks.
 *
 * `/api/documents/:id` wants the bearer header, so the file cannot simply be handed to a viewer
 * by URL — the bytes are fetched, written to the app's cache, and passed to the system's own
 * "open with" sheet. Nothing is kept: the copy goes in the cache directory the OS may reclaim,
 * and the server's original still leaves after a day (rule 5).
 *
 * A 404 here is not a failure to explain away. It means the run's cache has been purged, which
 * is the privacy promise working, and the server's own words for it are the right ones to show.
 */
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Text, View } from "react-native";
import { authorizedFetch } from "@/api";
import { color, space, type } from "@/theme";
import { Button } from "./ui";

export function OpenDocument({ id, name, available }: { id: string; name: string; available: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const res = await authorizedFetch(`/api/documents/${id}`);
      if (!res.ok) {
        // 404 is the 1-day cache having done its job; the body says so in the product's words.
        setError(await res.text());
        return;
      }
      const safe = name.replace(/[^\w .-]/g, "") || "document";
      const target = new FileSystem.File(FileSystem.Paths.cache, `${safe}.pdf`);
      if (target.exists) target.delete();
      target.create();
      target.write(new Uint8Array(await res.arrayBuffer()));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(target.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
      } else {
        setError("No app on this phone can open a PDF.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space.xs }}>
      <Button
        title={available ? `Open ${name}` : `${name} — no longer held`}
        variant="secondary"
        busy={busy}
        onPress={() => void (available ? open() : setError("This one has left the 1-day cache. Run Sync now, or wait for tonight."))}
      />
      {error ? <Text style={[type.small, { color: color.bad }]}>{error}</Text> : null}
    </View>
  );
}
