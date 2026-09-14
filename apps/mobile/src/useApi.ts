/**
 * Fetching, without a data library.
 *
 * The app has a handful of screens and one server; React Query would be more machinery than
 * there is work for it to do. This is the whole of what the screens need: load on focus, pull to
 * refresh, and an unauthorized answer that signs the phone out rather than showing an error.
 */
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, isUnauthorized } from "./api";
import { useSession } from "./session";

export interface Query<T> {
  data: T | null;
  error: string | null;
  /** True only for the first load; a refresh leaves the previous data on screen. */
  loading: boolean;
  refreshing: boolean;
  reload(): Promise<void>;
  /** Replace the data locally — how an optimistic tick shows before the server answers. */
  set(update: (current: T) => T): void;
}

export function useQuery<T>(fetcher: () => Promise<T>, deps: readonly unknown[] = []): Query<T> {
  const { signOut } = useSession();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const live = useRef(true);
  const run = useRef(fetcher);
  run.current = fetcher;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(
    async (mode: "first" | "refresh") => {
      if (mode === "refresh") setRefreshing(true);
      try {
        const next = await run.current();
        if (!live.current) return;
        setData(next);
        setError(null);
      } catch (err) {
        if (!live.current) return;
        // A session the server no longer honours is a signed-out app, not an error screen.
        if (isUnauthorized(err)) {
          await signOut();
          return;
        }
        setError(errorMessage(err));
      } finally {
        if (live.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [signOut],
  );

  useEffect(() => {
    setLoading(true);
    void load("first");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(() => load("refresh"), [load]);

  const set = useCallback((update: (current: T) => T) => {
    setData((current) => (current === null ? current : update(current)));
  }, []);

  return { data, error, loading, refreshing, reload, set };
}

/**
 * Reload when the screen comes back into view.
 *
 * The editors are a separate route, so returning from one must show what it changed. The first
 * focus is the mount, which `useQuery` has already handled — reloading there would fetch twice.
 */
export function useReloadOnReturn(reload: () => Promise<void>) {
  const first = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void reload();
    }, [reload]),
  );
}
