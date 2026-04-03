import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ZukovRuntime } from "../src/runtime.ts";
import { ProcessLinker } from "../src/core/linker.ts";
import { ProcessRegistry } from "../src/core/registry.ts";
import { TaskQueue } from "../src/task/queue.ts";
import { TaskScheduler } from "../src/task/scheduler.ts";
import { Reconnector } from "../src/node/reconnector.ts";
import { createAuthSignature, verifyAuthSignature, generateNonce } from "../src/security/auth.ts";
import { parsePayload } from "../src/protocol/serialize.ts";
import { MessageType } from "../src/protocol/protocol.ts";
import { Supervisor, type ChildSpec } from "../src/core/supervisor.ts";
import { RestartStrategy } from "../src/core/supervisor_types.ts";
import { TaskStatus } from "../src/types.ts";

describe("ZukovRuntime", () => {
  let runtime: ZukovRuntime;

  beforeEach(async () => {
    runtime = new ZukovRuntime("test-node");
    await runtime.start();
  });

  afterEach(async () => {
    await runtime.stop();
  });

  it("should start and stop", async () => {
    expect(runtime.getNodeId()).toBe("test-node");
    expect(runtime.getProcessCount()).toBe(1); // reply process
  });

  it("should spawn processes", async () => {
    const pid = await runtime.spawn({
      handleMessage: () => {},
    });
    expect(pid.startsWith("test-node:")).toBe(true);
    expect(runtime.getProcessCount()).toBe(2);
  });

  it("should send messages", async () => {
    const messages: unknown[] = [];
    const pid = await runtime.spawn({
      handleMessage: (msg) => {
        messages.push(msg);
      },
    });

    runtime.send(pid, "hello");
    runtime.send(pid, { type: "test" });

    await new Promise((r) => setTimeout(r, 50));
    expect(messages).toEqual(["hello", { type: "test" }]);
  });

  it("should handle request-reply", async () => {
    const pid = await runtime.spawn({
      handleMessage: (msg) => {
        const req = runtime.extractRequest(msg);
        if (req) {
          runtime.sendReply(req.payload as any, req.correlationId, "reply");
        }
      },
    });

    const reply = await runtime.sendAndWait(pid, { type: "request" }, 1000);
    expect(reply).toBe("reply");
  });

  it("should timeout on sendAndWait", async () => {
    const pid = await runtime.spawn({
      handleMessage: () => {},
    });

    const reply = await runtime.sendAndWait(pid, { type: "request" }, 100);
    expect(reply).toBeNull();
  });
});

describe("Process Linking", () => {
  let runtime: ZukovRuntime;

  beforeEach(async () => {
    runtime = new ZukovRuntime("link-node");
    await runtime.start();
  });

  afterEach(async () => {
    await runtime.stop();
  });

  it("should link processes", async () => {
    const pid1 = await runtime.spawn({ handleMessage: () => {} });
    const pid2 = await runtime.spawn({ handleMessage: () => {} });

    runtime.link(pid1, pid2);

    const process2 = runtime.getProcess(pid2);
    expect(process2).toBeDefined();
  });

  it("should unlink processes", async () => {
    const pid1 = await runtime.spawn({ handleMessage: () => {} });
    const pid2 = await runtime.spawn({ handleMessage: () => {} });

    runtime.link(pid1, pid2);
    runtime.unlink(pid1, pid2);

    expect(runtime.getProcessCount()).toBe(3);
  });

  it("should monitor processes", async () => {
    const pid1 = await runtime.spawn({ handleMessage: () => {} });
    const pid2 = await runtime.spawn({ handleMessage: () => {} });

    const ref = runtime.monitor(pid1, pid2);
    expect(ref).toBeTruthy();
  });

  it("should demonitor processes", async () => {
    const pid1 = await runtime.spawn({ handleMessage: () => {} });
    const pid2 = await runtime.spawn({ handleMessage: () => {} });

    const ref = runtime.monitor(pid1, pid2);
    const result = runtime.demonitor(ref, pid1, pid2);
    expect(result).toBe(true);
  });
});

describe("Supervisor", () => {
  let runtime: ZukovRuntime;

  beforeEach(async () => {
    runtime = new ZukovRuntime("sup-node");
    await runtime.start();
  });

  afterEach(async () => {
    await runtime.stop();
  });

  it("should start children", async () => {
    const supervisor = runtime.createSupervisor(RestartStrategy.OneForOne);
    const pids = await supervisor.startChildren([
      { id: "child1", spec: { handleMessage: () => {} } },
      { id: "child2", spec: { handleMessage: () => {} } },
    ]);

    expect(pids.size).toBe(2);
    expect(supervisor.getChildren()).toEqual(["child1", "child2"]);
  });

  it("should handle child exit for temporary children", async () => {
    const supervisor = runtime.createSupervisor(RestartStrategy.OneForOne);
    await supervisor.startChild({
      id: "temp-child",
      spec: { handleMessage: () => {} },
      restart: "temporary",
    });

    await supervisor.handleChildExit("temp-child", "normal");
    expect(supervisor.getChildren()).not.toContain("temp-child");
  });

  it("should handle child exit for transient children with normal exit", async () => {
    const supervisor = runtime.createSupervisor(RestartStrategy.OneForOne);
    await supervisor.startChild({
      id: "transient-child",
      spec: { handleMessage: () => {} },
      restart: "transient",
    });

    await supervisor.handleChildExit("transient-child", "normal");
    expect(supervisor.getChildren()).not.toContain("transient-child");
  });

  it("should restart permanent children", async () => {
    const supervisor = runtime.createSupervisor(RestartStrategy.OneForOne);
    await supervisor.startChild({
      id: "perm-child",
      spec: { handleMessage: () => {} },
      restart: "permanent",
    });

    const originalPid = supervisor.getChildPid("perm-child");
    await supervisor.handleChildExit("perm-child", "crash");

    const newPid = supervisor.getChildPid("perm-child");
    expect(newPid).toBeDefined();
    expect(newPid).not.toBe(originalPid);
  });
});

describe("TaskQueue", () => {
  it("should enqueue and take tasks", () => {
    const queue = new TaskQueue();
    const task1 = queue.enqueue("payload1");
    const task2 = queue.enqueue("payload2");

    expect(task1.id).toBe("task-1");
    expect(task2.id).toBe("task-2");

    const taken = queue.takeNext("worker:1");
    expect(taken?.id).toBe("task-1");
    expect(taken?.status).toBe(TaskStatus.Running);
  });

  it("should complete tasks", () => {
    const queue = new TaskQueue();
    queue.enqueue("payload");
    queue.takeNext("worker:1");

    const completed = queue.complete("task-1", "result");
    expect(completed?.status).toBe(TaskStatus.Completed);
    expect(completed?.result).toBe("result");
  });

  it("should handle task failure", () => {
    const queue = new TaskQueue();
    queue.enqueue("payload");
    queue.takeNext("worker:1");

    const failed = queue.complete("task-1", null, "error message");
    expect(failed?.status).toBe(TaskStatus.Failed);
    expect(failed?.error).toBe("error message");
  });

  it("should requeue tasks", () => {
    const queue = new TaskQueue();
    queue.enqueue("payload");
    queue.takeNext("worker:1");

    const requeued = queue.requeue("task-1");
    expect(requeued).toBe(true);

    const task = queue.get("task-1");
    expect(task?.status).toBe(TaskStatus.Pending);
    expect(task?.assignedTo).toBeUndefined();
  });

  it("should get pending count", () => {
    const queue = new TaskQueue();
    queue.enqueue("p1");
    queue.enqueue("p2");
    queue.takeNext("w:1");

    expect(queue.getPendingCount()).toBe(1);
  });

  it("should get in-flight tasks by worker", () => {
    const queue = new TaskQueue();
    queue.enqueue("p1");
    queue.enqueue("p2");
    queue.takeNext("w:1");
    queue.takeNext("w:2");

    const inFlight = queue.getInFlightByWorker("w:1");
    expect(inFlight.length).toBe(1);
    expect(inFlight[0].assignedTo).toBe("w:1");
  });

  it("should prioritize tasks", () => {
    const queue = new TaskQueue();
    queue.enqueue("low", { priority: 1 });
    queue.enqueue("high", { priority: 10 });
    queue.enqueue("medium", { priority: 5 });

    const taken = queue.takeNext("w:1");
    expect(taken?.payload).toBe("high");
  });
});

describe("TaskScheduler", () => {
  it("should submit tasks", () => {
    const scheduler = new TaskScheduler();
    const task = scheduler.submitTask({ payload: "test" });
    expect(task.id).toBeTruthy();
  });

  it("should start workers and process tasks", async () => {
    const scheduler = new TaskScheduler();
    const results: string[] = [];

    scheduler.startWorker(async (task) => {
      results.push(task.payload as string);
      return "done";
    });

    scheduler.submitTask({ payload: "task1" });
    scheduler.submitTask({ payload: "task2" });

    await new Promise((r) => setTimeout(r, 100));
    expect(results).toContain("task1");
    expect(results).toContain("task2");
  });

  it("should call onTaskComplete", async () => {
    const scheduler = new TaskScheduler();
    let completed = false;

    scheduler.onTaskComplete(() => {
      completed = true;
    });

    scheduler.startWorker(async () => "result");
    scheduler.submitTask({ payload: "test" });

    await new Promise((r) => setTimeout(r, 100));
    expect(completed).toBe(true);
  });
});

describe("Reconnector", () => {
  it("should schedule reconnect", () => {
    const reconnector = new Reconnector({ maxRetries: 3 });
    let attempts = 0;

    reconnector.scheduleReconnect("node-1", async () => {
      attempts++;
      return false;
    });

    expect(reconnector.isReconnecting("node-1")).toBe(true);
  });

  it("should cancel reconnect", () => {
    const reconnector = new Reconnector({ maxRetries: 10 });

    reconnector.scheduleReconnect("node-1", async () => false);
    reconnector.cancelReconnect("node-1");

    expect(reconnector.isReconnecting("node-1")).toBe(false);
  });

  it("should stop all reconnects", () => {
    const reconnector = new Reconnector({ maxRetries: 10 });

    reconnector.scheduleReconnect("node-1", async () => false);
    reconnector.scheduleReconnect("node-2", async () => false);
    reconnector.stopAll();

    expect(reconnector.getPendingNodes()).toEqual([]);
  });

  it("should succeed on reconnect", async () => {
    const reconnector = new Reconnector({ maxRetries: 5, initialDelay: 10 });
    let attempts = 0;

    const successPromise = new Promise<string>((resolve) => {
      reconnector.onReconnectSuccess((nodeId) => resolve(nodeId));
    });

    reconnector.scheduleReconnect("node-1", async () => {
      attempts++;
      return attempts >= 2;
    });

    const nodeId = await successPromise;
    expect(nodeId).toBe("node-1");
    expect(attempts).toBe(2);
  });
});

describe("Auth", () => {
  it("should create and verify signatures", () => {
    const secret = "my-secret-key";
    const nodeId = "node-1";
    const nonce = generateNonce();

    const signature = createAuthSignature(nodeId, nonce, secret);
    expect(verifyAuthSignature(nodeId, nonce, signature, secret)).toBe(true);
  });

  it("should reject invalid signatures", () => {
    const secret = "my-secret-key";
    const nodeId = "node-1";
    const nonce = generateNonce();

    const signature = createAuthSignature(nodeId, nonce, "wrong-secret");
    expect(verifyAuthSignature(nodeId, nonce, signature, secret)).toBe(false);
  });

  it("should generate unique nonces", () => {
    const nonce1 = generateNonce();
    const nonce2 = generateNonce();
    expect(nonce1).not.toBe(nonce2);
  });
});

describe("parsePayload", () => {
  it("should parse valid JSON payload", () => {
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify({ to: "node-1:1", message: "hello" }));
    const result = parsePayload<{ to: string; message: string }>(data);
    expect(result).toEqual({ to: "node-1:1", message: "hello" });
  });

  it("should return null for invalid JSON", () => {
    const encoder = new TextEncoder();
    const data = encoder.encode("not json");
    const result = parsePayload(data);
    expect(result).toBeNull();
  });
});
