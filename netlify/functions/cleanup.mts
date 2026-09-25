// Daily housekeeping: expired rate-limit windows.

import type { Config } from "@netlify/functions";
import { store } from "../lib/store.ts";

export default async () => {
  const s = store();
  let removed = 0;
  for (const { key } of (await s.list({ prefix: "limit/" })).blobs) {
    const start = Number(key.split("/").pop());
    if (Number.isFinite(start) && start * 1000 < Date.now() - 2 * 86400_000) { await s.delete(key); removed++; }
  }
  console.log("cleanup: removed", removed, "rate-limit keys");
};

export const config: Config = { schedule: "@daily" };
