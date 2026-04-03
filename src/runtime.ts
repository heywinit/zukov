import type { ProcessId, ProcessSpec, Message, ReconnectConfig, AuthConfig, Task, TaskSpec, TaskResult } from "./types.ts";
import { ZukovProcess } from "./core/process.ts";
import { ProcessRegistry } from "./core/registry.ts";
import { MessageRouter } from "./core/message.ts";
import { ProcessLinker } from "./core/linker.ts";
import { NodeRegistry } from "./node/registry.ts";
import { ManualDiscovery } from "./node/discovery.ts";
import type { NodeConfig } from "./node/discovery.ts";
import { ConnectionManager } from "./runtime/connection_manager.ts";
import { listenForConnections, type NodeConnection } from "./protocol/connection.ts";
import type { NodeId } from "./types.ts";
import { TaskScheduler } from "./task/scheduler.ts";
import { WorkerPool } from "./task/worker_pool.ts";
import type { TaskHandler } from "./task/types.ts";
import { Supervisor, type ChildSpec } from "./core/supervisor.ts";
import { RestartStrategy } from "./core/supervisor_types.ts";

export class ZukovRuntime {
  private nodeId: string;
  private registry: ProcessRegistry;
  private nodeRegistry: NodeRegistry;
  private router: MessageRouter;
  private linker: ProcessLinker;
  private discovery: ManualDiscovery;
  private connectionManager: ConnectionManager;
  private running = false;
  private listener?: any;
  private authConfig?: AuthConfig;
  private supervisors = new Map<string, Supervisor>();
  private taskScheduler: TaskScheduler;

  constructor(nodeId?: string) {
    this.nodeId = nodeId || this.generateNodeId();
    this.registry = new ProcessRegistry();
    this.nodeRegistry = new NodeRegistry(this.nodeId);
    this.router = new MessageRouter(this.registry, this.nodeRegistry, this.nodeId);
    this.linker = new ProcessLinker(
      this.registry,
      async (fromPid, toPid, reason) => {
        await this.router.sendExit(fromPid, toPid, reason);
      },
      async (ref, toPid, fromPid, reason) => {
        await this.router.sendDown(ref, toPid, fromPid, reason);
      },
    );
    this.router.setLinker(this.linker);
    this.discovery = new ManualDiscovery(this.nodeRegistry);
    this.connectionManager = new ConnectionManager(
      this.nodeRegistry,
      this.registry,
      this.router,
    );
    this.taskScheduler = new TaskScheduler();
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Runtime is already running");
    }
    this.running = true;

    const replyPid = await this.spawn({
      handleMessage: (message) => {
        if (this.router.isReply(message)) {
          this.router.handleReply(message);
        }
      },
    });
    this.router.setReplyProcess(replyPid);

    console.log(`Zukov node ${this.nodeId} started`);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.connectionManager.stopReconnector();

    const processes = this.registry.getAll();
    for (const process of processes) {
      if (process instanceof ZukovProcess) {
        process.terminate();
      }
    }

    this.registry = new ProcessRegistry();
    this.nodeRegistry = new NodeRegistry(this.nodeId);
    this.router = new MessageRouter(this.registry, this.nodeRegistry, this.nodeId);
    this.linker = new ProcessLinker(
      this.registry,
      async (fromPid, toPid, reason) => {
        await this.router.sendExit(fromPid, toPid, reason);
      },
      async (ref, toPid, fromPid, reason) => {
        await this.router.sendDown(ref, toPid, fromPid, reason);
      },
    );
    this.router.setLinker(this.linker);
    this.discovery = new ManualDiscovery(this.nodeRegistry);
    console.log(`Zukov node ${this.nodeId} stopped`);
  }

  async spawn(spec: ProcessSpec): Promise<ProcessId> {
    if (!this.running) {
      throw new Error("Runtime is not running");
    }

    const process = new ZukovProcess(this.nodeId, spec);
    this.registry.register(process);

    process.onExit(async (reason) => {
      await this.linker.processExited(process.pid, reason);
    });

    await process.start();

    return process.pid;
  }

  getProcess(pid: ProcessId): ZukovProcess | undefined {
    const proc = this.registry.get(pid);
    if (proc instanceof ZukovProcess) {
      return proc;
    }
    return undefined;
  }

  send(to: ProcessId, message: Message): boolean {
    if (!this.running) {
      return false;
    }
    return this.router.send(to, message);
  }

  async sendAndWait(to: ProcessId, message: Message, timeout = 5000): Promise<Message | null> {
    if (!this.running) {
      return null;
    }
    return await this.router.sendAndWait(to, message, timeout);
  }

  sendReply(to: ProcessId, correlationId: string, payload: Message): boolean {
    if (!this.running) {
      return false;
    }
    return this.router.sendReply(to, correlationId, payload);
  }

  isRequest(message: Message): boolean {
    return this.router.isRequest(message);
  }

  isReply(message: Message): boolean {
    return this.router.isReply(message);
  }

  extractRequest(message: Message): { correlationId: string; payload: Message } | null {
    return this.router.extractRequest(message);
  }

  link(pid1: ProcessId, pid2: ProcessId): void {
    this.router.sendLink(pid1, pid2);
  }

  unlink(pid1: ProcessId, pid2: ProcessId): void {
    this.router.sendUnlink(pid1, pid2);
  }

  monitor(fromPid: ProcessId, toPid: ProcessId): string {
    return this.router.sendMonitor(fromPid, toPid);
  }

  demonitor(ref: string, fromPid: ProcessId, toPid: ProcessId): boolean {
    return this.router.sendDemonitor(ref, fromPid, toPid);
  }

  getNodeId(): string {
    return this.nodeId;
  }

  getProcessCount(): number {
    return this.registry.size();
  }

  createSupervisor(strategy: RestartStrategy = RestartStrategy.OneForOne): Supervisor {
    const supervisor = new Supervisor(this, strategy);
    const supervisorId = `supervisor-${Date.now()}`;
    this.supervisors.set(supervisorId, supervisor);
    return supervisor;
  }

  addNode(config: NodeConfig): void {
    this.discovery.addNode(config);
  }

  async connectToNode(nodeId: string): Promise<boolean> {
    const node = this.nodeRegistry.get(nodeId);
    if (!node) {
      return false;
    }
    return await this.connectionManager.connect(nodeId, this.authConfig?.secret);
  }

  disconnectFromNode(nodeId: string): void {
    this.connectionManager.disconnect(nodeId);
  }

  getNodeRegistry(): NodeRegistry {
    return this.nodeRegistry;
  }

  getRouter(): MessageRouter {
    return this.router;
  }

  setReconnectConfig(config: ReconnectConfig): void {
    this.connectionManager.setReconnectConfig(config);
  }

  setAuthConfig(config: AuthConfig): void {
    this.authConfig = config;
  }

  async listen(port: number): Promise<void> {
    if (this.listener) {
      throw new Error("Already listening on a port");
    }

    this.listener = await listenForConnections(
      port,
      (conn, nodeId) => {
        const node = this.nodeRegistry.get(nodeId);
        if (!node) {
          const newNode = {
            id: nodeId,
            address: undefined,
            port: undefined,
            connected: true,
          };
          (this.nodeRegistry as any).nodes.set(nodeId, newNode);
        } else {
          node.markConnected();
        }

        const handler = {
          onMessage: async (type: any, payload: Uint8Array) => {
            await this.connectionManager["handleMessage"](type, payload, nodeId);
          },
          onClose: () => {
            const node = this.nodeRegistry.get(nodeId);
            node?.markDisconnected();
            (this.connectionManager as any).connections.delete(nodeId);
            this.router.removeConnection(nodeId);
          },
          onError: (error: Error) => {
            console.error(`Connection error with node ${nodeId}:`, error);
          },
          onAuthenticated: () => {
            console.log(`Node ${nodeId} authenticated`);
          },
        };

        conn.setHandler(handler);
        (this.connectionManager as any).connections.set(nodeId, conn);
        this.router.setConnection(nodeId, conn);
      },
      this.authConfig?.secret,
    );

    console.log(`Listening on port ${port}`);
  }

  submitTask<T = Message>(spec: TaskSpec<T>) {
    return this.taskScheduler.submitTask(spec);
  }

  startTaskWorker(handler: (task: Task) => Promise<Message>): void {
    this.taskScheduler.startWorker(handler);
  }

  onTaskComplete(callback: (task: Task) => void | Promise<void>): void {
    this.taskScheduler.onTaskComplete(callback);
  }

  onTaskFailed(callback: (task: Task) => void | Promise<void>): void {
    this.taskScheduler.onTaskFailed(callback);
  }

  createWorkerPool(handler: TaskHandler, initialSize: number = 0): WorkerPool {
    return new WorkerPool(this, handler, initialSize);
  }

  private generateNodeId(): string {
    return `node-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
