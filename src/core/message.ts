/**
 * Message passing system
 * Handles routing messages between processes
 */

import type { ProcessId, Message } from "../types.js";
import { ProcessRegistry } from "./registry.js";
import { isLocalPid } from "./pid.js";

export class MessageRouter {
  constructor(
    private registry: ProcessRegistry,
    private nodeId: string
  ) {}

  /**
   * Send a message to a process
   * Currently only supports local processes
   */
  send(to: ProcessId, message: Message): boolean {
    // Check if it's a local process
    if (!isLocalPid(to, this.nodeId)) {
      // TODO: Route to remote node
      console.warn(`Remote message routing not yet implemented: ${to}`);
      return false;
    }

    const process = this.registry.get(to);
    if (!process) {
      console.warn(`Process not found: ${to}`);
      return false;
    }

    if (process.state === "terminated") {
      return false;
    }

    process.send(message);
    return true;
  }

  /**
   * Send a message and wait for a reply
   * Uses a simple request-reply pattern
   */
  async sendAndWait(
    to: ProcessId,
    message: Message,
    timeout = 5000
  ): Promise<Message | null> {
    // Create a temporary process to receive the reply
    // For now, we'll use a simpler approach with callbacks
    // TODO: Implement proper request-reply with correlation IDs
    
    return new Promise((resolve) => {
      const process = this.registry.get(to);
      if (!process) {
        resolve(null);
        return;
      }

      // Simple timeout
      const timer = setTimeout(() => {
        resolve(null);
      }, timeout);

      // This is a simplified version - in a real implementation,
      // we'd need correlation IDs and proper reply routing
      process.send(message);
      
      // For now, just resolve after sending
      // Proper implementation would wait for actual reply
      clearTimeout(timer);
      resolve(null);
    });
  }
}
