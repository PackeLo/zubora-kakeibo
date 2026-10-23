import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("wrangler/package.json"))("esbuild");
const temporary = path.join(root, "app/connection/dist/catalog-export");
await mkdir(temporary, { recursive: true });
await mkdir(path.join(root, "app/connection/generated"), { recursive: true });
await build({
  stdin: { contents: `
    import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
    import { createToolServer, serverInstructions } from './app/back/src/adapters/mcp/tools';
    import { createUseCases } from './app/back/src/worker/bootstrap';
    import { InMemoryUnitOfWork } from './app/back/src/adapters/memory/InMemoryRepositories';
    import { supportedScopes } from './app/back/src/adapters/auth/scopes';
    const server = createToolServer(createUseCases(new InMemoryUnitOfWork(), {}), { id: 'catalog', displayName: 'catalog', role: 'admin' }, supportedScopes, 'https://catalog.example/mcp');
    const client = new Client({ name: 'catalog-export', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = (await client.listTools()).tools.map(({ _meta, ...tool }) => tool);
    await client.close(); await server.close();
    export default { instructions: serverInstructions, tools };
  `, resolveDir: root, loader: "ts" },
  bundle: true, packages: "external", format: "esm", platform: "node",
  outfile: path.join(temporary, "catalog.mjs")
});
const catalog = (await import(pathToFileURL(path.join(temporary, "catalog.mjs")).href + `?${Date.now()}`)).default;
if (catalog.tools.length !== 17) throw new Error("Unexpected tool catalog");
await writeFile(path.join(root, "app/connection/generated/tools.json"), JSON.stringify(catalog, null, 2) + "\n");
const distribution = path.join(root, "app/connection/dist");
await mkdir(path.join(distribution, "server"), { recursive: true });
await build({ entryPoints: [path.join(root, "app/connection/worker.ts")], bundle: true, format: "esm", platform: "browser", conditions: ["workerd", "worker", "browser"], target: "es2022", outfile: path.join(distribution, "server/index.js") });
console.log(`Built connection server with ${catalog.tools.length} tools`);
