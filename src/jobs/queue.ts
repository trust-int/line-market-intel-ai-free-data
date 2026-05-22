import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export type QueueName = "line-ingest" | "collect-news" | "collect-market" | "analysis" | "reports";

let redisConnection: Redis | undefined;

export function getQueue(name: QueueName): Queue | undefined {
  if (!config.redisUrl) return undefined;
  redisConnection ??= new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  return new Queue(name, { connection: redisConnection });
}

export async function enqueueOrRun<T>(
  queueName: QueueName,
  jobName: string,
  payload: Record<string, unknown>,
  fallback: () => Promise<T>
): Promise<T | { queued: true }> {
  const queue = getQueue(queueName);
  if (!queue) {
    logger.debug("REDIS_URL not set; running job inline", { queueName, jobName });
    return fallback();
  }
  await queue.add(jobName, payload, {
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 }
  });
  return { queued: true };
}
