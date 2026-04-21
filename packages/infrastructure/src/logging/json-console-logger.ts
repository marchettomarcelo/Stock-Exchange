import type { LogFields, Logger } from "@decade/application";

const levelRank = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
} as const;

export interface JsonConsoleLoggerOptions {
  serviceName: string;
  level: keyof typeof levelRank;
  sink?: Pick<typeof console, "debug" | "info" | "warn" | "error">;
}

export class JsonConsoleLogger implements Logger {
  private readonly sink: Pick<typeof console, "debug" | "info" | "warn" | "error">;

  constructor(private readonly options: JsonConsoleLoggerOptions) {
    this.sink = options.sink ?? console;
  }

  debug(message: string, fields?: LogFields): void {
    this.write("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.write("error", message, fields);
  }

  private write(level: keyof typeof levelRank, message: string, fields?: LogFields): void {
    if (levelRank[level] < levelRank[this.options.level]) {
      return;
    }

    this.sink[level](
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: this.options.serviceName,
        message,
        ...fields
      })
    );
  }
}
