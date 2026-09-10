import { Injectable, LoggerService } from "@nestjs/common";

interface HttpLogFields extends Record<string, unknown> {
  requestId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
}

type LogLevel = "debug" | "info" | "warn" | "error";

@Injectable()
export class StructuredLoggerService implements LoggerService {
  log(message: string, context?: string): void {
    this.write("info", message, context);
  }

  error(message: string, trace?: string, context?: string): void {
    this.write("error", message, context, trace ? { trace } : undefined);
  }

  warn(message: string, context?: string): void {
    this.write("warn", message, context);
  }

  debug(message: string, context?: string): void {
    this.write("debug", message, context);
  }

  verbose(message: string, context?: string): void {
    this.write("debug", message, context);
  }

  logHttp(fields: HttpLogFields): void {
    this.write("info", "http_request", undefined, fields);
  }

  private write(level: LogLevel, message: string, context?: string, fields?: Record<string, unknown>): void {
    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      ...fields
    };

    const serialized = JSON.stringify(payload);
    if (level === "error") {
      console.error(serialized);
      return;
    }
    if (level === "warn") {
      console.warn(serialized);
      return;
    }
    console.log(serialized);
  }
}
