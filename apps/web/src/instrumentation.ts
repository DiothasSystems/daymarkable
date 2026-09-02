/**
 * Server start hook. Phase 0 runs the 3AM scheduler inside the web process so a single
 * process owns the embedded database locally; set DAYMARKABLE_SCHEDULER=0 to disable
 * (the Docker deploy runs the runner container instead). The runtime check lets Next strip
 * the Node-only import from the edge bundle.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootScheduler } = await import("./server/scheduler-boot");
    await bootScheduler();
  }
}
