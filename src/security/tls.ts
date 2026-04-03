import type { TLSConfig } from "../types.ts";

export async function wrapTLSServer(
  socket: any,
  config: TLSConfig,
): Promise<any> {
  const { default: tls } = await import("node:tls");

  return new Promise((resolve, reject) => {
    const secureSocket = new tls.TLSSocket(socket, {
      isServer: true,
      cert: Buffer.from(config.cert),
      key: Buffer.from(config.key),
      ca: config.ca ? [Buffer.from(config.ca)] : undefined,
      rejectUnauthorized: config.rejectUnauthorized ?? false,
    });

    secureSocket.on("error", reject);
    secureSocket.on("secureConnection", () => {
      resolve(secureSocket);
    });
  });
}

export async function connectTLS(
  hostname: string,
  port: number,
  config: TLSConfig,
): Promise<any> {
  const { default: tls } = await import("node:tls");

  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: hostname,
        port,
        cert: Buffer.from(config.cert),
        key: Buffer.from(config.key),
        ca: config.ca ? [Buffer.from(config.ca)] : undefined,
        rejectUnauthorized: config.rejectUnauthorized ?? false,
      },
      () => {
        resolve(socket);
      },
    );

    socket.on("error", reject);
  });
}

export function isTLSAvailable(): boolean {
  try {
    require("node:tls");
    return true;
  } catch {
    return false;
  }
}
