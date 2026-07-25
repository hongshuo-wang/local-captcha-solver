import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';

export const fixtureProxyPort = 32145;
const PORT = fixtureProxyPort;
const HOST = '127.0.0.1';

export const fixtureHostname = 'captcha.e2e.test';
export const fixtureOrigin = `http://${fixtureHostname}`;
export const fixtureServerOrigin = `http://${HOST}:${PORT}`;

const pages = new Map([
  ['/automatic.html', new URL('./automatic.html', import.meta.url)],
  ['/dynamic.html', new URL('./dynamic.html', import.meta.url)],
  ['/ambiguous.html', new URL('./ambiguous.html', import.meta.url)],
]);

const images = new Map([
  ['/fixtures/digits-002.png', new URL('../../../benchmark/fixtures/generated/digits-002.png', import.meta.url)],
  ['/fixtures/digits-017.png', new URL('../../../benchmark/fixtures/generated/digits-017.png', import.meta.url)],
]);

export interface FixtureServer {
  readonly origin: string;
  readonly requests: readonly string[];
  close(): Promise<void>;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

export async function startFixtureServer(): Promise<FixtureServer> {
  const requests: string[] = [];
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', fixtureOrigin).pathname;
    requests.push(path);
    const page = pages.get(path);
    const image = images.get(path);

    try {
      if (page !== undefined) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(await readFile(page));
        return;
      }
      if (image !== undefined) {
        response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' });
        response.end(await readFile(image));
        return;
      }
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
    } catch (error) {
      response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : 'Fixture read failed');
    }
  });

  server.listen(PORT, HOST);
  await once(server, 'listening');
  return { origin: fixtureOrigin, requests, close: () => close(server) };
}
