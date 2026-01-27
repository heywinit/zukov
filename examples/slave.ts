import { ZukovRuntime } from "../src/index.ts";

function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

async function main() {
  const masterPidArg = process.argv[2];
  if (!masterPidArg) {
    console.error("Usage: bun run examples/slave.ts <master-process-pid>");
    console.error("Example: bun run examples/slave.ts master:1");
    process.exit(1);
  }

  const slaveId = `slave-${Date.now()}`;
  const runtime = new ZukovRuntime(slaveId);
  await runtime.start();

  console.log(`Slave node started: ${slaveId}`);

  runtime.addNode({
    id: "master",
    address: "localhost",
    port: 8080,
  });

  const connected = await runtime.connectToNode("master");
  if (!connected) {
    console.error("Failed to connect to master. Make sure master is running.");
    await runtime.stop();
    process.exit(1);
  }

  console.log("Connected to master");

  const workerPid = await runtime.spawn({
    init: () => {
      console.log("Worker process initialized");
    },
    handleMessage: async (message) => {
      if (typeof message === "object" && message !== null) {
        const msg = message as { type: string; taskId?: string; n?: number };

        if (msg.type === "calculate" && msg.taskId && typeof msg.n === "number") {
          console.log(`Received task ${msg.taskId}: calculating fibonacci(${msg.n})`);

          const delay = Math.random() * 3000;
          await new Promise((resolve) => setTimeout(resolve, delay));

          const start = Date.now();
          const result = fibonacci(msg.n);
          const duration = Date.now() - start;

          console.log(
            `Task ${msg.taskId} completed: fibonacci(${msg.n}) = ${result} (took ${duration}ms, delay: ${Math.round(delay)}ms)`
          );

          runtime.send(masterPidArg as any, {
            type: "result",
            taskId: msg.taskId,
            n: msg.n,
            result,
            slavePid: workerPid,
          });
        }
      }
    },
  });

  console.log(`Worker PID: ${workerPid}`);
  console.log(`Slave node ID: ${slaveId}`);
  
  runtime.send(masterPidArg as any, {
    type: "slave_ready",
    slavePid: workerPid,
    slaveNodeId: slaveId,
  });
  
  console.log("Worker ready, waiting for tasks...\n");

  process.on("SIGINT", async () => {
    console.log("\nShutting down slave...");
    await runtime.stop();
    process.exit(0);
  });

  await new Promise(() => {});
}

main().catch(console.error);
