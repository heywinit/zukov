# zukov

distributed task runner for bun with multi-node compute, inspired by erlang/otp.

## usage

```typescript
import { ZukovRuntime, RestartStrategy } from "zukov";

const runtime = new ZukovRuntime("node-1");
await runtime.start();

// spawn a process
const pid = await runtime.spawn({
  init: () => {
    console.log("process started");
  },
  handleMessage: (msg) => {
    if (msg === "ping") {
      console.log("received ping");
    } else if (typeof msg === "object" && msg !== null) {
      const m = msg as { type: string; data?: unknown };
      if (m.type === "task") {
        console.log("processing task:", m.data);
      }
    }
  },
});

// send messages
runtime.send(pid, "ping");
runtime.send(pid, { type: "task", data: "compute" });

// request-reply pattern
const reply = await runtime.sendAndWait(pid, { type: "request" }, 5000);
console.log("got reply:", reply);

// multi-node: listen for connections
await runtime.listen(8080);

// connect to another node
runtime.addNode({
  id: "node-2",
  address: "localhost",
  port: 8081,
});
await runtime.connectToNode("node-2");

// send to remote process (format: "node-id:local-pid")
const remotePid = "node-2:1";
runtime.send(remotePid, "hello from node-1");

console.log("process count:", runtime.getProcessCount());
console.log("node id:", runtime.getNodeId());

await runtime.stop();
```

## concepts

processes are isolated units of computation. they communicate via message passing. each process has a unique PID and can send messages to any PID, including processes on remote nodes.

multi-node: start a runtime with `listen(port)` to accept connections. add nodes with `addNode({ id, address, port })` then connect with `connectToNode(nodeId)`. processes can send messages across nodes transparently using the `node-id:local-pid` format.

supervisors manage process lifecycles and restart strategies.

## process linking & monitoring

processes can be linked so that when one exits, the other is notified. this is the foundation of fault tolerance.

```typescript
// link two processes (bidirectional)
runtime.link(pid1, pid2);
runtime.unlink(pid1, pid2);

// monitor a process (unidirectional, returns a ref)
const ref = runtime.monitor(pid1, pid2);
runtime.demonitor(ref, pid1, pid2);
```

exit messages are delivered as `{ type: "exit", fromPid, toPid, reason }` to linked processes.
down messages are delivered as `{ type: "down", ref, fromPid, toPid, reason }` to monitoring processes.

## supervisors

supervisors manage child process lifecycles with three restart strategies:

- **OneForOne** — only restart the failed child
- **OneForAll** — restart all children when any one fails
- **RestForOne** — restart the failed child and all children started after it

```typescript
import { RestartStrategy } from "zukov";

const supervisor = runtime.createSupervisor(RestartStrategy.OneForOne);

await supervisor.startChildren([
  { id: "worker-1", spec: { handleMessage: () => {} }, restart: "permanent" },
  { id: "worker-2", spec: { handleMessage: () => {} }, restart: "transient" },
  { id: "temp-task", spec: { handleMessage: () => {} }, restart: "temporary" },
]);

// restart policies:
// "permanent" — always restart on exit
// "transient" — restart only on abnormal exit (reason !== "normal")
// "temporary" — never restart, remove from supervision
```

supervisors also enforce restart intensity limits (max 5 restarts per 60s by default).

## distributed task scheduling

### simple scheduler

```typescript
// submit tasks
runtime.submitTask({ payload: { compute: "fibonacci", n: 42 } });

// start a worker that processes tasks
runtime.startTaskWorker(async (task) => {
  console.log("processing:", task.payload);
  return { result: 42 };
});

// listen for completions
runtime.onTaskComplete((task) => {
  console.log("task done:", task.result);
});

runtime.onTaskFailed((task) => {
  console.error("task failed:", task.error);
});
```

### worker pool

```typescript
const pool = runtime.createWorkerPool(
  async (task) => {
    // process task
    return { result: "done" };
  },
  4, // initial worker count
);

await pool.submitTask({ type: "compute", data: "heavy" });
await pool.scaleUp(2);  // add 2 more workers
await pool.scaleDown(1); // remove 1 idle worker

pool.onTaskComplete((result) => {
  console.log("completed:", result.taskId);
});

await pool.stop();
```

## connection reconnection

configure automatic reconnection for dropped connections:

```typescript
runtime.setReconnectConfig({
  maxRetries: 10,       // -1 for infinite retries
  maxDelay: 30000,      // max backoff delay in ms
  initialDelay: 1000,   // initial backoff delay in ms
});
```

connections use exponential backoff. when a connection drops, the reconnector schedules retries automatically.

## authentication & encryption

### shared secret handshake

```typescript
runtime.setAuthConfig({
  secret: "my-shared-secret",
});
```

all connections require HMAC-SHA256 authentication before exchanging messages. unauthenticated connections are rejected.

### TLS

```typescript
runtime.setAuthConfig({
  secret: "my-shared-secret",
  tls: {
    cert: fs.readFileSync("cert.pem", "utf-8"),
    key: fs.readFileSync("key.pem", "utf-8"),
    rejectUnauthorized: true,
  },
});
```

TLS encrypts all traffic. set `rejectUnauthorized: false` for self-signed certs in development.

## api reference

### ZukovRuntime

| method | description |
|--------|-------------|
| `start()` | start the runtime |
| `stop()` | stop the runtime and terminate all processes |
| `spawn(spec)` | create a new process, returns PID |
| `send(pid, message)` | fire-and-forget message send |
| `sendAndWait(pid, message, timeout)` | request-reply pattern |
| `sendReply(to, correlationId, payload)` | respond to a request |
| `link(pid1, pid2)` | link two processes |
| `unlink(pid1, pid2)` | unlink two processes |
| `monitor(fromPid, toPid)` | monitor a process, returns ref |
| `demonitor(ref, fromPid, toPid)` | stop monitoring |
| `createSupervisor(strategy)` | create a supervisor |
| `listen(port)` | accept incoming connections |
| `addNode(config)` | register a known remote node |
| `connectToNode(nodeId)` | connect to a remote node |
| `disconnectFromNode(nodeId)` | disconnect from a remote node |
| `setReconnectConfig(config)` | configure reconnection behavior |
| `setAuthConfig(config)` | configure auth and TLS |
| `submitTask(spec)` | submit a task to the scheduler |
| `startTaskWorker(handler)` | start a task processing worker |
| `onTaskComplete(callback)` | register task completion handler |
| `onTaskFailed(callback)` | register task failure handler |
| `createWorkerPool(handler, size)` | create a managed worker pool |
| `getNodeId()` | get this node's ID |
| `getProcessCount()` | get number of running processes |

see `examples/` for more.
