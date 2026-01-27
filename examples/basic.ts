import { ZukovRuntime } from "../src/index.ts";

async function main() {
  const runtime = new ZukovRuntime("node-1");
  await runtime.start();

  // Spawn a process that echoes messages
  const echoPid = await runtime.spawn({
    init: () => {
      console.log("Echo process initialized");
    },
    handleMessage: (message) => {
      console.log(`Echo process received:`, message);
    },
  });

  console.log(`Spawned echo process: ${echoPid}`);

  // Send some messages
  runtime.send(echoPid, "Hello, Zukov!");
  runtime.send(echoPid, { type: "greeting", text: "How are you?" });
  runtime.send(echoPid, 42);

  // Wait a bit for messages to process
  await new Promise((resolve) => setTimeout(resolve, 100));

  console.log(`Process count: ${runtime.getProcessCount()}`);

  await runtime.stop();
}

main().catch(console.error);
