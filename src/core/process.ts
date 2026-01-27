/**
 * Process abstraction - lightweight isolated execution context
 */

import type { Process, ProcessId, ProcessSpec, Message, ProcessState } from "../types.js";
import { createPid, generateLocalPid } from "./pid.js";

export class ZukovProcess implements Process {
  public readonly pid: ProcessId;
  public state: ProcessState = ProcessState.Init;
  public mailbox: Message[] = [];
  public onMessage?: (message: Message) => void | Promise<void>;

  private spec: ProcessSpec;
  private running = false;

  constructor(nodeId: string, spec: ProcessSpec) {
    this.pid = createPid(nodeId, generateLocalPid());
    this.spec = spec;
  }

  /**
   * Start the process
   */
  async start(): Promise<void> {
    if (this.state !== ProcessState.Init) {
      throw new Error(`Process ${this.pid} is not in init state`);
    }

    this.state = ProcessState.Running;
    this.running = true;

    // Run init if provided
    if (this.spec.init) {
      try {
        await this.spec.init();
      } catch (error) {
        this.terminate();
        throw error;
      }
    }

    // Start message loop
    this.messageLoop();
  }

  /**
   * Send a message to this process
   */
  send(message: Message): void {
    if (this.state === ProcessState.Terminated) {
      return;
    }
    this.mailbox.push(message);
  }

  /**
   * Terminate the process
   */
  terminate(): void {
    this.state = ProcessState.Terminated;
    this.running = false;
    this.mailbox = [];
  }

  /**
   * Message processing loop
   */
  private async messageLoop(): Promise<void> {
    while (this.running && this.state === ProcessState.Running) {
      if (this.mailbox.length > 0) {
        const message = this.mailbox.shift()!;
        
        try {
          if (this.onMessage) {
            await this.onMessage(message);
          } else if (this.spec.handleMessage) {
            await this.spec.handleMessage(message);
          }
        } catch (error) {
          console.error(`Error handling message in process ${this.pid}:`, error);
          // Process continues running even if message handling fails
        }
      } else {
        // Yield to event loop when no messages
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }
}
