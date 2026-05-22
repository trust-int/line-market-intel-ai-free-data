import express from "express";
import { db } from "../db/client.js";

export function createWatchlistRouter() {
  const router = express.Router();
  router.get("/", async (_req, res) => {
    const rows = await db.query("select * from watchlist where active = true order by ticker");
    res.json({ rows: rows.rows });
  });
  router.post("/", async (req, res) => {
    const row = req.body;
    await db.query(
      `insert into watchlist (ticker, name, themes, source, note)
       values ($1,$2,$3,$4,$5)
       on conflict (ticker) do update set name = excluded.name, themes = excluded.themes, source = excluded.source, note = excluded.note, active = true`,
      [row.ticker, row.name, row.themes ?? [], row.source ?? "manual", row.note]
    );
    res.status(201).json({ ok: true });
  });
  return router;
}
