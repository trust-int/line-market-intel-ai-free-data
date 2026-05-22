type LogContext = Record<string, unknown>;

function write(level: "info" | "warn" | "error" | "debug", message: string, context?: LogContext): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(context ? { context } : {})
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, context?: LogContext) => write("error", message, context),
  debug: (message: string, context?: LogContext) => {
    if (process.env.NODE_ENV !== "production") write("debug", message, context);
  }
};
