import type { ProcessId, ProcessSpec, Message } from "./types.ts";
import { ZukovProcess } from "./core/process.ts";
import { ProcessRegistry } from "./core/registry.ts";
import { MessageRouter } from "./core/message.ts";

export class ZukovRuntime {
  private nodeId: string;
  private registry: ProcessRegistry;
  private router: MessageRouter;
  private running = false;

  constructor(nodeId?: string) {
    this.nodeId = nodeId || this.generateNodeId();
    this.registry = new ProcessRegistry();
    this.router = new MessageRouter(this.registry, this.nodeId);
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Runtime is already running");
    }
    this.running = true;
    console.log(`Zukov node ${this.nodeId} started`);
  }

  async stop(): Promise<void> {
    this.running = false;
    // Terminate all processes
    const processes = this.registry.getAll();
    for (const process of processes) {
      if (process instanceof ZukovProcess) {
        process.terminate();
      }
    }
    this.registry = new ProcessRegistry();
    this.router = new MessageRouter(this.registry, this.nodeId);
    console.log(`Zukov node ${this.nodeId} stopped`);
  }

  async spawn(spec: ProcessSpec): Promise<ProcessId> {
    if (!this.running) {
      throw new Error("Runtime is not running");
    }

    const process = new ZukovProcess(this.nodeId, spec);
    this.registry.register(process);
    await process.start();

    return process.pid;
  }

  send(to: ProcessId, message: Message): boolean {
    if (!this.running) {
      return false;
    }
    return this.router.send(to, message);
  }

  getNodeId(): string {
    return this.nodeId;
  }

  getProcessCount(): number {
    return this.registry.size();
  }

  private generateNodeId(): string {
    return `node-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
