import type { ProcessId, ProcessSpec } from "../types.ts";
import type { ZukovRuntime } from "../runtime.ts";
import { RestartStrategy } from "./supervisor_types.ts";

export interface ChildSpec {
  id: string;
  spec: ProcessSpec;
  restart?: "permanent" | "transient" | "temporary";
}

interface ChildRecord {
  spec: ChildSpec;
  pid: ProcessId;
}

export class Supervisor {
  private children = new Map<string, ChildRecord>();
  private childOrder: string[] = [];
  private restartStrategy: RestartStrategy;
  private maxRestartIntensity: { maxRestarts: number; timeWindow: number } = {
    maxRestarts: 5,
    timeWindow: 60000,
  };
  private restartTimestamps: number[] = [];

  constructor(
    private runtime: ZukovRuntime,
    restartStrategy: RestartStrategy = RestartStrategy.OneForOne,
  ) {
    this.restartStrategy = restartStrategy;
  }

  async startChild(childSpec: ChildSpec): Promise<ProcessId> {
    if (this.children.has(childSpec.id)) {
      throw new Error(`Child ${childSpec.id} already exists`);
    }

    const pid = await this.runtime.spawn(childSpec.spec);
    const record: ChildRecord = { spec: childSpec, pid };
    this.children.set(childSpec.id, record);
    this.childOrder.push(childSpec.id);

    await this.runtime.link(this.runtime.getNodeId() + ":0", pid);

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
        if (this.restartStrategy === RestartStrategy.OneForAll) {
          await this.terminateAll();
          throw error;
        }
        throw error;
      }
    }

    return pids;
  }

  async handleChildExit(childId: string, reason: string): Promise<void> {
    const record = this.children.get(childId);
    if (!record) {
      return;
    }

    const restart = record.spec.restart || "permanent";

    if (restart === "temporary") {
      this.children.delete(childId);
      this.childOrder = this.childOrder.filter((id) => id !== childId);
      return;
    }

    if (restart === "transient" && reason === "normal") {
      this.children.delete(childId);
      this.childOrder = this.childOrder.filter((id) => id !== childId);
      return;
    }

    if (!this.checkRestartIntensity()) {
      console.error(
        `Supervisor: max restart intensity reached, terminating all children`,
      );
      await this.terminateAll();
      return;
    }

    this.restartTimestamps.push(Date.now());

    switch (this.restartStrategy) {
      case RestartStrategy.OneForOne:
        await this.restartOneForOne(childId, reason);
        break;
      case RestartStrategy.OneForAll:
        await this.restartOneForAll(reason);
        break;
      case RestartStrategy.RestForOne:
        await this.restartRestForOne(childId, reason);
        break;
    }
  }

  private async restartOneForOne(childId: string, reason: string): Promise<void> {
    const record = this.children.get(childId);
    if (!record) return;

    try {
      const newPid = await this.runtime.spawn(record.spec.spec);
      this.children.set(childId, { ...record, pid: newPid });
      await this.runtime.link(this.runtime.getNodeId() + ":0", newPid);
    } catch (error) {
      console.error(`Failed to restart child ${childId}:`, error);
    }
  }

  private async restartOneForAll(reason: string): Promise<void> {
    const allChildren = Array.from(this.children.entries());

    for (const [childId, record] of allChildren) {
      try {
        const process = this.runtime.getProcess(record.pid);
        if (process && process.state !== "terminated") {
          process.terminate();
        }
      } catch {
        // process already gone
      }
    }

    for (const [childId, record] of allChildren) {
      try {
        const newPid = await this.runtime.spawn(record.spec.spec);
        this.children.set(childId, { ...record, pid: newPid });
        await this.runtime.link(this.runtime.getNodeId() + ":0", newPid);
      } catch (error) {
        console.error(`Failed to restart child ${childId}:`, error);
        await this.terminateAll();
        return;
      }
    }
  }

  private async restartRestForOne(failedChildId: string, reason: string): Promise<void> {
    const failedIndex = this.childOrder.indexOf(failedChildId);
    if (failedIndex === -1) return;

    const toRestart = this.childOrder.slice(failedIndex);

    for (const childId of toRestart) {
      const record = this.children.get(childId);
      if (!record) continue;

      try {
        const process = this.runtime.getProcess(record.pid);
        if (process && process.state !== "terminated") {
          process.terminate();
        }
      } catch {
        // process already gone
      }
    }

    for (const childId of toRestart) {
      const record = this.children.get(childId);
      if (!record) continue;

      try {
        const newPid = await this.runtime.spawn(record.spec.spec);
        this.children.set(childId, { ...record, pid: newPid });
        await this.runtime.link(this.runtime.getNodeId() + ":0", newPid);
      } catch (error) {
        console.error(`Failed to restart child ${childId}:`, error);
        await this.terminateAll();
        return;
      }
    }
  }

  private checkRestartIntensity(): boolean {
    const now = Date.now();
    const windowStart = now - this.maxRestartIntensity.timeWindow;

    this.restartTimestamps = this.restartTimestamps.filter(
      (ts) => ts > windowStart,
    );

    return this.restartTimestamps.length < this.maxRestartIntensity.maxRestarts;
  }

  private async terminateAll(): Promise<void> {
    for (const [childId, record] of this.children.entries()) {
      try {
        const process = this.runtime.getProcess(record.pid);
        if (process && process.state !== "terminated") {
          process.terminate();
        }
      } catch {
        // process already gone
      }
    }
    this.children.clear();
    this.childOrder = [];
  }

  async restartChild(childId: string): Promise<ProcessId | null> {
    const record = this.children.get(childId);
    if (!record) {
      return null;
    }

    const oldPid = this.pids.get(childId);
    if (oldPid) {
      const process = this.runtime.getProcess(oldPid);
      if (process && process.state !== "terminated") {
        process.terminate();
      }
    }

    try {
      const newPid = await this.runtime.spawn(record.spec.spec);
      this.children.set(childId, { ...record, pid: newPid });
      return newPid;
    } catch (error) {
      console.error(`Failed to restart child ${childId}:`, error);
      return null;
    }
  }

  getChildPid(childId: string): ProcessId | undefined {
    return this.children.get(childId)?.pid;
  }

  getChildren(): string[] {
    return Array.from(this.children.keys());
  }

  setRestartStrategy(strategy: RestartStrategy): void {
    this.restartStrategy = strategy;
  }

  setMaxRestartIntensity(maxRestarts: number, timeWindow: number): void {
    this.maxRestartIntensity = { maxRestarts, timeWindow };
  }
}
