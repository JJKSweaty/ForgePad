/** Wait for mounted editors before changing their navigation or session state. */
export async function flushDrafts() {
  const waits: Promise<unknown>[] = [];
  window.dispatchEvent(new CustomEvent("forgepad:flush", { detail: waits }));
  await Promise.all(waits);
}
