import express from "express";
import { db } from "../db/client.js";

export function createHoldingsRouter() {
  const router = express.Router();
  router.get("/", async (_req, res) => {
    const rows = await db.query("select * from holdings where active = true order by ticker");
    res.json({ rows: rows.rows });
  });
  router.post("/", async (req, res) => {
    const row = req.body;
    await db.query(
      `insert into holdings (ticker, name, qty, avg_cost, strategy, thesis, stop_loss, take_profit)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [row.ticker, row.name, row.qty, row.avg_cost, row.strategy, row.thesis, row.stop_loss, row.take_profit]
    );
    res.status(201).json({ ok: true });
  });
  return router;
}
