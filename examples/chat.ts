import { ZukovRuntime } from "../src/index.ts";

async function main() {
  const runtime = new ZukovRuntime("node-1");
  await runtime.start();

  // Create a chat room process that broadcasts messages
  const chatRoomPid = await runtime.spawn({
    init: () => {
      console.log("Chat room opened");
    },
    handleMessage: (message) => {
      if (typeof message === "object" && message !== null) {
        const msg = message as { user: string; text: string; broadcast?: boolean };
        if (msg.broadcast) {
          console.log(`[CHAT] ${msg.user}: ${msg.text}`);
        } else {
          console.log(`[DM] ${msg.user}: ${msg.text}`);
        }
      }
    },
  });

  // Create user processes
  const alicePid = await runtime.spawn({
    init: () => {
      console.log("Alice joined");
      // Alice sends a message
      runtime.send(chatRoomPid, {
        user: "Alice",
        text: "Hello everyone!",
        broadcast: true,
      });
    },
    handleMessage: (message) => {
      console.log("Alice received:", message);
    },
  });

  const bobPid = await runtime.spawn({
    init: () => {
      console.log("Bob joined");
      // Bob sends a message after a delay
      setTimeout(() => {
        runtime.send(chatRoomPid, {
          user: "Bob",
          text: "Hey Alice!",
          broadcast: true,
        });
      }, 100);
    },
    handleMessage: (message) => {
      console.log("Bob received:", message);
    },
  });

  const charliePid = await runtime.spawn({
    init: () => {
      console.log("Charlie joined");
      setTimeout(() => {
        runtime.send(chatRoomPid, {
          user: "Charlie",
          text: "What's up?",
          broadcast: true,
        });
      }, 200);
    },
    handleMessage: (message) => {
      console.log("Charlie received:", message);
    },
  });

  console.log(`\nProcess IDs:
  Chat Room: ${chatRoomPid}
  Alice:     ${alicePid}
  Bob:       ${bobPid}
  Charlie:   ${charliePid}\n`);

  // Wait for messages to process
  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log(`\nTotal processes: ${runtime.getProcessCount()}`);
  await runtime.stop();
}

main().catch(console.error);
