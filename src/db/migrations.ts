import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function loadSchemaSql(): Promise<string> {
  const url = new URL("../../supabase/schema.sql", import.meta.url);
  return readFile(url, "utf8");
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const schema = await loadSchemaSql();
  process.stdout.write(schema);
}
