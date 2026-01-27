import { Node } from "./node.ts";
import { NodeRegistry } from "./registry.ts";
import type { NodeId } from "../types.ts";

export interface NodeConfig {
  id: NodeId;
  address?: string;
  port?: number;
}

export class ManualDiscovery {
  constructor(private registry: NodeRegistry) {}

  addNode(config: NodeConfig): Node {
    if (config.id === this.registry.getLocalNodeId()) {
      throw new Error("Cannot add local node to discovery");
    }

    const node = new Node(config.id, config.address, config.port);
    this.registry.register(node);
    return node;
  }

  addNodes(configs: NodeConfig[]): Node[] {
    return configs.map((config) => this.addNode(config));
  }

  async connect(nodeId: NodeId): Promise<boolean> {
    const node = this.registry.get(nodeId);
    if (!node) {
      return false;
    }

    // TODO: Implement actual connection logic
    // For now, just mark as connected
    node.markConnected();
    return true;
  }

  async connectAll(): Promise<void> {
    const nodes = this.registry.getAll();
    for (const node of nodes) {
      if (!node.connected) {
        await this.connect(node.id);
      }
    }
  }
}
