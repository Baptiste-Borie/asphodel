import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createInterface, type Interface } from "node:readline";
import {
  FORGE_PROTOCOL_VERSION,
  type ForgeRequest,
  type ForgeResultMap,
  type ForgeWireResponse,
} from "./forge-protocol.js";

const DEFAULT_JAR_PATH = fileURLToPath(
  new URL(
    "../../../forge-bridge/app/target/asphodel-forge-bridge.jar",
    import.meta.url,
  ),
);
const DEFAULT_FORGE_ASSETS_PATH = fileURLToPath(
  new URL("../../../vendor/forge/forge-gui/res/", import.meta.url),
);

export interface ForgeBridgeClientOptions {
  javaPath?: string;
  jarPath?: string;
  forgeAssetsPath?: string;
  requestTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  onStderr?: (line: string) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class ForgeBridgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ForgeBridgeError";
  }
}

export class ForgeBridgeProcessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForgeBridgeProcessError";
  }
}

export class ForgeBridgeClient {
  private readonly javaPath: string;
  private readonly jarPath: string;
  private readonly forgeAssetsPath: string;
  private readonly requestTimeoutMs: number;
  private readonly shutdownTimeoutMs: number;
  private readonly onStderr: (line: string) => void;
  private readonly pending = new Map<string, PendingRequest>();
  private process: ChildProcessWithoutNullStreams | undefined;
  private stdout: Interface | undefined;
  private stderr: Interface | undefined;

  constructor(options: ForgeBridgeClientOptions = {}) {
    this.javaPath = options.javaPath ?? "java";
    this.jarPath = options.jarPath ?? DEFAULT_JAR_PATH;
    this.forgeAssetsPath = options.forgeAssetsPath ?? DEFAULT_FORGE_ASSETS_PATH;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 35_000;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 2_000;
    this.onStderr = options.onStderr ?? (() => undefined);
  }

  get isRunning(): boolean {
    return this.process !== undefined;
  }

  get pid(): number | undefined {
    return this.process?.pid;
  }

  async start(): Promise<void> {
    if (this.process) {
      return;
    }

    const child = spawn(this.javaPath, [
      `-Dasphodel.forge.assets=${this.forgeAssetsPath}`,
      "-jar",
      this.jarPath,
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.process = child;
    this.stdout = createInterface({ input: child.stdout });
    this.stderr = createInterface({ input: child.stderr });
    this.stdout.on("line", (line) => this.handleResponseLine(line));
    this.stderr.on("line", (line) => this.onStderr(line));
    child.stdin.on("error", (error) => {
      if (this.process === child) {
        child.kill("SIGTERM");
        this.handleProcessFailure(
          child,
          new ForgeBridgeProcessError(
            `Forge bridge stdin failed: ${error.message}`,
          ),
        );
      }
    });
    child.once("exit", (code, signal) => this.handleExit(child, code, signal));

    await new Promise<void>((resolve, reject) => {
      let spawned = false;
      const handleSpawn = () => {
        spawned = true;
        resolve();
      };
      const handleError = (error: Error) => {
        child.off("spawn", handleSpawn);
        this.handleExit(child, null, null);
        const processError =
          new ForgeBridgeProcessError(
            `Unable to start the Forge bridge: ${error.message}`,
          );
        if (!spawned) {
          reject(processError);
        }
      };
      child.once("spawn", handleSpawn);
      child.once("error", handleError);
    });
  }

  async request<Request extends ForgeRequest>(
    request: Request,
  ): Promise<ForgeResultMap[Request["type"]]> {
    const child = this.process;
    if (!child || child.exitCode !== null || child.stdin.destroyed) {
      throw new ForgeBridgeProcessError("The Forge bridge is not running.");
    }

    const requestId = randomUUID();
    const wireRequest = {
      ...request,
      protocolVersion: FORGE_PROTOCOL_VERSION,
      requestId,
    };

    return new Promise<ForgeResultMap[Request["type"]]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new ForgeBridgeProcessError(
            `Forge bridge request timed out after ${this.requestTimeoutMs} ms.`,
          ),
        );
      }, this.requestTimeoutMs);

      this.pending.set(requestId, {
        resolve: (value) =>
          resolve(value as ForgeResultMap[Request["type"]]),
        reject,
        timer,
      });

      child.stdin.write(`${JSON.stringify(wireRequest)}\n`, (error) => {
        if (!error) {
          return;
        }
        const pending = this.pending.get(requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pending.delete(requestId);
          pending.reject(
            new ForgeBridgeProcessError(
              `Unable to write to the Forge bridge: ${error.message}`,
            ),
          );
        }
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.process;
    if (!child) {
      return;
    }

    await new Promise<void>((resolve) => {
      if (this.process !== child) {
        resolve();
        return;
      }

      const timer = setTimeout(() => child.kill("SIGTERM"), this.shutdownTimeoutMs);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end();
    });
  }

  private handleResponseLine(line: string): void {
    let response: ForgeWireResponse;
    try {
      response = JSON.parse(line) as ForgeWireResponse;
    } catch {
      this.failAll(new ForgeBridgeProcessError("Forge emitted invalid NDJSON."));
      return;
    }

    if (
      response.protocolVersion !== FORGE_PROTOCOL_VERSION ||
      typeof response.requestId !== "string" ||
      typeof response.ok !== "boolean"
    ) {
      this.failAll(
        new ForgeBridgeProcessError("Forge emitted an invalid protocol response."),
      );
      return;
    }

    const pending = this.pending.get(response.requestId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(response.requestId);

    if (response.ok) {
      pending.resolve(response.result);
    } else {
      pending.reject(
        new ForgeBridgeError(
          response.error.code,
          response.error.message,
          response.error.details,
        ),
      );
    }
  }

  private handleExit(
    child: ChildProcessWithoutNullStreams,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (this.process !== child) {
      return;
    }
    this.handleProcessFailure(
      child,
      new ForgeBridgeProcessError(
        `Forge bridge exited (code=${String(code)}, signal=${String(signal)}).`,
      ),
    );
  }

  private handleProcessFailure(
    child: ChildProcessWithoutNullStreams,
    error: ForgeBridgeProcessError,
  ): void {
    if (this.process !== child) {
      return;
    }
    this.stdout?.close();
    this.stderr?.close();
    this.stdout = undefined;
    this.stderr = undefined;
    this.process = undefined;
    this.failAll(error);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
