import type { ProcessId, ProcessSpec, Message } from "./types.ts";
import { ZukovProcess } from "./core/process.ts";
import { ProcessRegistry } from "./core/registry.ts";
import { MessageRouter } from "./core/message.ts";
import { NodeRegistry } from "./node/registry.ts";
import { ManualDiscovery } from "./node/discovery.ts";
import type { NodeConfig } from "./node/discovery.ts";
import { ConnectionManager } from "./runtime/connection_manager.ts";
import { listenForConnections, type NodeConnection } from "./protocol/connection.ts";
import type { NodeId } from "./types.ts";

export class ZukovRuntime {
  private nodeId: string;
  private registry: ProcessRegistry;
  private nodeRegistry: NodeRegistry;
  private router: MessageRouter;
  private discovery: ManualDiscovery;
  private connectionManager: ConnectionManager;
  private running = false;
  private listener?: any;

  constructor(nodeId?: string) {
    this.nodeId = nodeId || this.generateNodeId();
    this.registry = new ProcessRegistry();
    this.nodeRegistry = new NodeRegistry(this.nodeId);
    this.router = new MessageRouter(this.registry, this.nodeRegistry, this.nodeId);
    this.discovery = new ManualDiscovery(this.nodeRegistry);
    this.connectionManager = new ConnectionManager(
      this.nodeRegistry,
      this.registry,
      this.router,
    );
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Runtime is already running");
    }
    this.running = true;

    // Set up reply process for request-reply pattern
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
    // Terminate all processes
    const processes = this.registry.getAll();
    for (const process of processes) {
      if (process instanceof ZukovProcess) {
        process.terminate();
      }
    }
    this.registry = new ProcessRegistry();
    this.nodeRegistry = new NodeRegistry(this.nodeId);
    this.router = new MessageRouter(this.registry, this.nodeRegistry, this.nodeId);
    this.discovery = new ManualDiscovery(this.nodeRegistry);
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

  getNodeId(): string {
    return this.nodeId;
  }

  getProcessCount(): number {
    return this.registry.size();
  }

  addNode(config: NodeConfig): void {
    this.discovery.addNode(config);
  }

  async connectToNode(nodeId: string): Promise<boolean> {
    const node = this.nodeRegistry.get(nodeId);
    if (!node) {
      return false;
    }
    return await this.connectionManager.connect(nodeId);
  }

  getNodeRegistry(): NodeRegistry {
    return this.nodeRegistry;
  }

  getRouter(): MessageRouter {
    return this.router;
  }

  async listen(port: number): Promise<void> {
    if (this.listener) {
      throw new Error("Already listening on a port");
    }

    this.listener = await listenForConnections(port, (conn, nodeId) => {
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
          const decoder = new TextDecoder();
          const json = decoder.decode(payload);
          const data = JSON.parse(json);
          
          if (type === 2) {
            const { to, message } = data;
            const process = this.registry.get(to);
            if (process) {
              process.send(message);
            }
          }
        },
        onClose: () => {
          const node = this.nodeRegistry.get(nodeId);
          node?.markDisconnected();
          (this.connectionManager as any).connections.delete(nodeId);
        },
        onError: (error: Error) => {
          console.error(`Connection error with node ${nodeId}:`, error);
        },
      };
      
      conn.setHandler(handler);
      (this.connectionManager as any).connections.set(nodeId, conn);
      this.router.setConnection(nodeId, conn);
    });

    console.log(`Listening on port ${port}`);
  }

  private generateNodeId(): string {
    return `node-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}
