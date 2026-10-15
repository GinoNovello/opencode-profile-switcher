import type { ProfilesFile } from "../../src/core/schema.js"

/**
 * A profiles file with one active profile (`glm`) covering every placement:
 * two heavy agents, a rest agent, an excluded one and a specific one.
 */
export function makeProfiles(overrides: Partial<ProfilesFile> = {}): ProfilesFile {
  return {
    profiles: {
      glm: {
        heavy: { model: "zai/glm-5", variant: "max" },
        rest: { model: "zai/glm-4" },
        placements: {
          build: "heavy",
          plan: "heavy",
          explore: "rest",
          vision: "excluded",
          docs: "specific",
        },
        specifics: { docs: { model: "anthropic/claude-docs", variant: "high" } },
      },
    },
    active: "glm",
    effective: {},
    ...overrides,
  }
}
