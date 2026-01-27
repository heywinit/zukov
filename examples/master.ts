import { ZukovRuntime } from "../src/index.ts";

async function main() {
  const runtime = new ZukovRuntime("master");
  await runtime.start();
  await runtime.listen(8080);

  console.log("Master node started");
  console.log(`Master node ID: ${runtime.getNodeId()}`);
  console.log("Waiting for slaves to connect...\n");

  const tasks = new Map<string, { n: number; slavePid: string }>();
  const slaves = new Set<string>();
  const slaveLastTask = new Map<string, number>();
  let taskIdCounter = 0;

  const masterPid = await runtime.spawn({
    init: () => {
      console.log("Master process initialized");
    },
    handleMessage: async (message) => {
      if (typeof message === "object" && message !== null) {
        const msg = message as {
          type: string;
          slavePid?: string;
          taskId?: string;
          n?: number;
          result?: number;
        };

        if (msg.type === "slave_ready") {
          const slavePid = msg.slavePid!;
          const slaveNodeId = (msg as any).slaveNodeId;
          
          if (slaveNodeId) {
            const nodeRegistry = runtime.getNodeRegistry();
            const node = nodeRegistry.get(slaveNodeId);
            if (!node) {
              const newNode = {
                id: slaveNodeId,
                address: undefined,
                port: undefined,
                connected: true,
              };
              (nodeRegistry as any).nodes.set(slaveNodeId, newNode);
            }
            
            const connManager = (runtime as any).connectionManager;
            const connections = connManager.connections as Map<string, any>;
            const tempNodeId = Array.from(connections.keys()).find(
              (id) => typeof id === "string" && id.startsWith("node-") && id !== "master"
            ) as string | undefined;
            if (tempNodeId) {
              const conn = connections.get(tempNodeId);
              if (conn) {
                connections.delete(tempNodeId);
                connections.set(slaveNodeId, conn);
                runtime.getRouter().removeConnection(tempNodeId);
                runtime.getRouter().setConnection(slaveNodeId, conn);
                (conn as any).nodeId = slaveNodeId;
              }
            }
          }
          
          slaves.add(slavePid);
          slaveLastTask.set(slavePid, Date.now());
          console.log(`Slave connected: ${slavePid} (node: ${slaveNodeId})`);

          const n = Math.floor(Math.random() * 11);
          const taskId = `task-${++taskIdCounter}`;
          tasks.set(taskId, { n, slavePid });

          console.log(`Assigning task ${taskId}: fibonacci(${n}) to ${slavePid}`);
          runtime.send(slavePid as any, {
            type: "calculate",
            taskId,
            n,
          });
        } else if (msg.type === "result") {
          const task = tasks.get(msg.taskId!);
          if (task) {
            console.log(
              `Task ${msg.taskId} completed: fibonacci(${task.n}) = ${msg.result}`
            );
            tasks.delete(msg.taskId!);

            const slavePid = msg.slavePid!;
            const lastTaskTime = slaveLastTask.get(slavePid) || 0;
            const timeSinceLastTask = Date.now() - lastTaskTime;
            const delay = 10000 - timeSinceLastTask;

            if (delay > 0) {
              setTimeout(() => {
                const n = Math.floor(Math.random() * 11);
                const newTaskId = `task-${++taskIdCounter}`;
                tasks.set(newTaskId, { n, slavePid });

                console.log(
                  `Assigning task ${newTaskId}: fibonacci(${n}) to ${slavePid}`
                );
                runtime.send(slavePid as any, {
                  type: "calculate",
                  taskId: newTaskId,
                  n,
                });
                slaveLastTask.set(slavePid, Date.now());
              }, delay);
            } else {
              const n = Math.floor(Math.random() * 11);
              const newTaskId = `task-${++taskIdCounter}`;
              tasks.set(newTaskId, { n, slavePid });

              console.log(
                `Assigning task ${newTaskId}: fibonacci(${n}) to ${slavePid}`
              );
              runtime.send(slavePid as any, {
                type: "calculate",
                taskId: newTaskId,
                n,
              });
              slaveLastTask.set(slavePid, Date.now());
            }
          }
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
