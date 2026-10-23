import { vi } from "vitest";

vi.stubGlobal("Cloudflare", { compatibilityFlags: { global_fetch_strictly_public: true } });
export class WorkerEntrypoint {}
