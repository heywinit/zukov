import type { ProcessId, ProcessSpec } from "../types.ts";
import type { ZukovRuntime } from "../runtime.ts";

export enum RestartStrategy {
  OneForOne = "one_for_one",
  OneForAll = "one_for_all",
  RestForOne = "rest_for_one",
}

export interface ChildSpec {
  id: string;
  spec: ProcessSpec;
  restart?: "permanent" | "transient" | "temporary";
}

export class Supervisor {
  private children = new Map<string, ChildSpec>();
  private pids = new Map<string, ProcessId>();
  private restartStrategy: RestartStrategy;

  constructor(
    private runtime: ZukovRuntime,
    restartStrategy: RestartStrategy = RestartStrategy.OneForOne
  ) {
    this.restartStrategy = restartStrategy;
  }

  async startChild(childSpec: ChildSpec): Promise<ProcessId> {
    if (this.children.has(childSpec.id)) {
      throw new Error(`Child ${childSpec.id} already exists`);
    }

    const pid = await this.runtime.spawn(childSpec.spec);
    this.children.set(childSpec.id, childSpec);
    this.pids.set(childSpec.id, pid);

    return pid;
  }

  async startChildren(specs: ChildSpec[]): Promise<Map<string, ProcessId>> {
    const pids = new Map<string, ProcessId>();

    for (const spec of specs) {
      try {
        const pid = await this.startChild(spec);
        pids.set(spec.id, pid);
      } catch (error) {
        console.error(`Failed to start child ${spec.id}:`, error);
        throw error;
      }
    }

    return pids;
  }

  async restartChild(childId: string): Promise<ProcessId | null> {
    const childSpec = this.children.get(childId);
    if (!childSpec) {
      return null;
    }

    const oldPid = this.pids.get(childId);
    if (oldPid) {
      // TODO: Process will be terminated, we'll restart it
    }

    try {
      const newPid = await this.runtime.spawn(childSpec.spec);
      this.pids.set(childId, newPid);
      return newPid;
    } catch (error) {
      console.error(`Failed to restart child ${childId}:`, error);
      return null;
    }
  }

  async handleChildExit(childId: string, reason: string): Promise<void> {
    const childSpec = this.children.get(childId);
    if (!childSpec) {
      return;
    }

    const restart = childSpec.restart || "permanent";

    if (restart === "temporary") {
      this.children.delete(childId);
      this.pids.delete(childId);
      return;
    }

    if (restart === "transient" && reason === "normal") {
      this.children.delete(childId);
      this.pids.delete(childId);
      return;
    }

    // Restart the child
    await this.restartChild(childId);
  }

  getChildPid(childId: string): ProcessId | undefined {
    return this.pids.get(childId);
  }

  getChildren(): string[] {
    return Array.from(this.children.keys());
  }

  setRestartStrategy(strategy: RestartStrategy): void {
    this.restartStrategy = strategy;
  }
}
