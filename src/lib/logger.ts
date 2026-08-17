export type LogMetadata = Record<string, unknown>;

export interface Logger {
  info(message: string, meta?: LogMetadata): void;
  warn(message: string, meta?: LogMetadata): void;
  error(message: string, meta?: LogMetadata): void;
  debug(message: string, meta?: LogMetadata): void;
}

class SafeLogger implements Logger {
  private format(level: string, message: string, meta?: LogMetadata): string {
    const timestamp = new Date().toISOString();
    if (meta && Object.keys(meta).length > 0) {
      return `[${timestamp}] [${level.toUpperCase()}] ${message} ${JSON.stringify(meta)}`;
    }
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  }

  info(message: string, meta?: LogMetadata): void {
    console.log(this.format('info', message, meta));
  }

  warn(message: string, meta?: LogMetadata): void {
    console.warn(this.format('warn', message, meta));
  }

  error(message: string, meta?: LogMetadata): void {
    console.error(this.format('error', message, meta));
  }

  debug(message: string, meta?: LogMetadata): void {
    if (process.env.NODE_ENV === 'development') {
      console.debug(this.format('debug', message, meta));
    }
  }
}

export const logger: Logger = new SafeLogger();
