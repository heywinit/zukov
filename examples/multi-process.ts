import { ZukovRuntime } from "../src/index.ts";

async function main() {
  const runtime = new ZukovRuntime("node-1");
  await runtime.start();

  // Create a message relay process
  const relayPid = await runtime.spawn({
    init: () => {
      console.log("Relay process started");
    },
    handleMessage: async (message) => {
      if (typeof message === "object" && message !== null) {
        const msg = message as { target?: string; data: unknown };
        if (msg.target) {
          console.log(`Relay: forwarding message to ${msg.target}`);
          runtime.send(msg.target as any, msg.data);
        } else {
          console.log("Relay: received", message);
        }
      }
    },
  });

  // Create a worker process
  const workerPid = await runtime.spawn({
    init: () => {
      console.log("Worker process started");
    },
    handleMessage: (message) => {
      console.log(`Worker: processing`, message);
    },
  });

  // Create a logger process
  const loggerPid = await runtime.spawn({
    init: () => {
      console.log("Logger process started");
    },
    handleMessage: (message) => {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] LOG:`, message);
    },
  });

  console.log(`\nProcess IDs:
  Relay:  ${relayPid}
  Worker: ${workerPid}
  Logger: ${loggerPid}\n`);

  // Send messages through the relay
  runtime.send(relayPid, { target: workerPid, data: "Task 1" });
  runtime.send(relayPid, { target: loggerPid, data: "Task 1 completed" });
  runtime.send(relayPid, { target: workerPid, data: "Task 2" });
  runtime.send(relayPid, { target: loggerPid, data: "Task 2 completed" });

  // Send direct messages
  runtime.send(workerPid, "Direct message to worker");
  runtime.send(loggerPid, "Direct message to logger");

  // Wait for messages to process
  await new Promise((resolve) => setTimeout(resolve, 300));

  console.log(`\nTotal processes: ${runtime.getProcessCount()}`);
  await runtime.stop();
}

main().catch(console.error);
