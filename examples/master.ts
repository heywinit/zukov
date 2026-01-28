import { ZukovRuntime } from "../src/index.ts";
import { TaskQueue } from "../src/task/queue.ts";
import type { Task } from "../src/types.ts";

type FibTaskPayload = { n: number };

type MasterMessage =
  | {
      type: "slave_ready";
      slavePid: string;
      slaveNodeId: string;
    }
  | {
      type: "result";
      slavePid: string;
      taskId: string;
      n: number;
      result: number;
    };

async function main() {
  const runtime = new ZukovRuntime("master");
  await runtime.start();
  await runtime.listen(8080);

  console.log("Master node started");
  console.log(`Master node ID: ${runtime.getNodeId()}`);
  console.log("Waiting for slaves to connect...\n");

  const queue = new TaskQueue<FibTaskPayload>();
  const slaves = new Set<string>();
  const slaveLastTask = new Map<string, number>();

  const assignTaskToSlave = (slavePid: string) => {
    const task = queue.enqueue({ n: Math.floor(Math.random() * 11) });
    console.log(
      `Assigning task ${task.id}: fibonacci(${task.payload.n}) to ${slavePid}`,
    );
    slaveLastTask.set(slavePid, Date.now());
    (globalThis as any).runtime.send(slavePid as any, {
      type: "calculate",
      taskId: task.id,
      n: task.payload.n,
    });
  };

  const masterPid = await runtime.spawn({
    init: () => {
      console.log("Master process initialized");
    },
    handleMessage: async (message) => {
      const msg = message as MasterMessage;

      if (msg.type === "slave_ready") {
        const slavePid = msg.slavePid;
        const slaveNodeId = msg.slaveNodeId;

        // For now we trust the connection mapping done in runtime.listen
        slaves.add(slavePid);
        slaveLastTask.set(slavePid, Date.now());
        console.log(`Slave connected: ${slavePid} (node: ${slaveNodeId})`);

        assignTaskToSlave(slavePid);
      } else if (msg.type === "result") {
        const task = queue.complete(msg.taskId, msg.result);
        if (task) {
          console.log(
            `Task ${msg.taskId} completed: fibonacci(${task.payload.n}) = ${msg.result}`,
          );
        }

        const slavePid = msg.slavePid;
        const lastTaskTime = slaveLastTask.get(slavePid) || 0;
        const timeSinceLastTask = Date.now() - lastTaskTime;
        const delay = 10000 - timeSinceLastTask;

        const schedule = () => {
          assignTaskToSlave(slavePid);
        };

        if (delay > 0) {
          setTimeout(schedule, delay);
        } else {
          schedule();
        }
      }
    },
  });

  console.log(`Master process PID: ${masterPid}`);
  console.log("Master is running. Press Ctrl+C to stop.\n");

  process.on("SIGINT", async () => {
    console.log("\nShutting down master...");
    await runtime.stop();
    process.exit(0);
  });

  await new Promise(() => {});
}

main().catch(console.error);
