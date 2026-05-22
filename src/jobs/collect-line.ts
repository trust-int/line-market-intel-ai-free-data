export async function collectLineJob(): Promise<{ ok: true; note: string }> {
  return { ok: true, note: "LINE events are ingested by webhook; this job is a placeholder for backfill/retry." };
}
