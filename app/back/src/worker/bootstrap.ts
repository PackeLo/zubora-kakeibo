import { KakeiboUseCases } from "../application/useCases";
import type { UnitOfWork } from "../ports/repositories";
import type { Env } from "./bindings";
import { parseDisplayNames } from "../application/householdProfiles";

export function createUseCases(repositories: UnitOfWork, env: Env) {
  return new KakeiboUseCases(repositories, {
    liveCompletedYearsToKeep: Number(env.LIVE_COMPLETED_YEARS_TO_KEEP ?? 3),
    displayNames: parseDisplayNames(env.USER_DISPLAY_NAMES_JSON)
  });
}
