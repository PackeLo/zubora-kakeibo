import { KakeiboUseCases } from "../application/useCases";
import type { UnitOfWork } from "../ports/repositories";
import type { Env } from "./bindings";

export function createUseCases(repositories: UnitOfWork, env: Env) {
  return new KakeiboUseCases(repositories, {
    liveCompletedYearsToKeep: Number(env.LIVE_COMPLETED_YEARS_TO_KEEP ?? 3)
  });
}
