# zukov

distributed task runner for bun with multi-node compute, inspired by erlang.

## usage

```typescript
import { ZukovRuntime } from "zukov";

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

see `examples/` for more.
