import type { Message, ProcessId, Task, TaskResult } from "../types.ts";
import { TaskStatus } from "../types.ts";
import type { ZukovRuntime } from "../runtime.ts";
import { TaskQueue } from "./queue.ts";

type TaskHandler = (task: Task) => Promise<Message>;
type TaskCompleteCallback = (result: TaskResult) => void | Promise<void>;
type TaskFailedCallback = (result: TaskResult) => void | Promise<void>;

interface WorkerInstance {
  id: string;
  pid: ProcessId;
  busy: boolean;
  currentTask?: Task;
}

export class WorkerPool {
  private workers = new Map<string, WorkerInstance>();
  private queue: TaskQueue;
  private handler: TaskHandler;
  private workerCounter = 0;
  private onTaskComplete?: TaskCompleteCallback;
  private onTaskFailed?: TaskFailedCallback;
  private taskResults = new Map<string, TaskResult>();

  constructor(
    private runtime: ZukovRuntime,
    handler: TaskHandler,
    initialSize: number = 0,
  ) {
    this.handler = handler;
    this.queue = new TaskQueue();

    for (let i = 0; i < initialSize; i++) {
      this.spawnWorker();
    }
  }

  async submitTask(payload: Message, options?: { timeout?: number; priority?: number }): Promise<string> {
    const task = this.queue.enqueue(payload, {
      timeout: options?.timeout,
      priority: options?.priority ?? 0,
      retries: 0,
    });
    await this.distributeTask();
    return task.id;
  }

  async scaleUp(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      await this.spawnWorker();
    }
    await this.distributeAllPending();
  }

  async scaleDown(count: number): Promise<void> {
    const idleWorkers = Array.from(this.workers.values())
      .filter((w) => !w.busy)
      .slice(0, count);

    for (const worker of idleWorkers) {
      this.workers.delete(worker.id);
      const process = this.runtime.getProcess(worker.pid);
      if (process && process.state !== "terminated") {
        process.terminate();
      }
    }
  }

  onTaskComplete(callback: TaskCompleteCallback): void {
    this.onTaskComplete = callback;
  }

  onTaskFailed(callback: TaskFailedCallback): void {
    this.onTaskFailed = callback;
  }

  getWorkerCount(): number {
    return this.workers.size;
  }

  getBusyCount(): number {
    return Array.from(this.workers.values()).filter((w) => w.busy).length;
  }

  getPendingCount(): number {
    return this.queue.getPendingCount();
  }

  getTaskResult(taskId: string): TaskResult | undefined {
    return this.taskResults.get(taskId);
  }

  async handleWorkerExit(pid: ProcessId): Promise<void> {
    let exitedWorker: WorkerInstance | undefined;
    for (const [id, worker] of this.workers) {
      if (worker.pid === pid) {
        exitedWorker = worker;
        this.workers.delete(id);
        break;
      }
    }

    if (exitedWorker && exitedWorker.currentTask) {
      const task = exitedWorker.currentTask;
      task.status = TaskStatus.Failed;
      task.error = "worker_exited";

      const result: TaskResult = {
        taskId: task.id,
        success: false,
        error: "worker_exited",
        completedAt: Date.now(),
      };

      this.taskResults.set(task.id, result);
      await this.onTaskFailed?.(result);

      await this.spawnWorker();
      await this.distributeTask();
    }
  }

  async stop(): Promise<void> {
    for (const worker of this.workers.values()) {
      const process = this.runtime.getProcess(worker.pid);
      if (process && process.state !== "terminated") {
        process.terminate();
      }
    }
    this.workers.clear();
  }

  private async spawnWorker(): Promise<ProcessId> {
    const workerId = `worker-${++this.workerCounter}`;

    const pid = await this.runtime.spawn({
      init: () => {},
      handleMessage: async (message) => {
        const data = message as { type?: string; taskId?: string; payload?: Message };
        if (data?.type === "execute_task") {
          const worker = this.workers.get(workerId);
          if (!worker) return;

          worker.busy = true;

          const task = this.queue.get(data.taskId!);
          if (!task) {
            worker.busy = false;
            return;
          }

          worker.currentTask = task;
          task.status = TaskStatus.Running;
          task.assignedTo = worker.pid;
          task.startedAt = Date.now();

          try {
            const result = await this.handler(task);
            task.status = TaskStatus.Completed;
            task.completedAt = Date.now();
            task.result = result;

            const taskResult: TaskResult = {
              taskId: task.id,
              success: true,
              result,
              completedAt: Date.now(),
            };
            this.taskResults.set(task.id, taskResult);
            await this.onTaskComplete?.(taskResult);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            task.status = TaskStatus.Failed;
            task.completedAt = Date.now();
            task.error = errorMsg;

            const taskResult: TaskResult = {
              taskId: task.id,
              success: false,
              error: errorMsg,
              completedAt: Date.now(),
            };
            this.taskResults.set(task.id, taskResult);
            await this.onTaskFailed?.(taskResult);
          }

          worker.busy = false;
          worker.currentTask = undefined;
          await this.distributeTask();
        }
      },
    });

    this.workers.set(workerId, {
      id: workerId,
      pid,
      busy: false,
    });

    return pid;
  }

  private async distributeTask(): Promise<void> {
    const idleWorker = Array.from(this.workers.values()).find((w) => !w.busy);
    if (!idleWorker) return;

    const task = this.queue.takeNext(idleWorker.pid);
    if (!task) return;

    idleWorker.busy = true;
    idleWorker.currentTask = task;

    this.runtime.send(idleWorker.pid, {
      type: "execute_task",
      taskId: task.id,
      payload: task.payload,
    });
  }

  private async distributeAllPending(): Promise<void> {
    while (true) {
      const idleWorker = Array.from(this.workers.values()).find((w) => !w.busy);
      if (!idleWorker) break;

      const task = this.queue.takeNext(idleWorker.pid);
      if (!task) break;

      idleWorker.busy = true;
      idleWorker.currentTask = task;

      this.runtime.send(idleWorker.pid, {
        type: "execute_task",
        taskId: task.id,
        payload: task.payload,
      });
    }
  }
}
