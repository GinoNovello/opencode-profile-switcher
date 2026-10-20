import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// npm only ships the LICENSE found in the package directory, so packages/v2
// keeps a versioned copy of the repo's. This keeps the two from drifting.
describe("published package", () => {
  test("LICENSE matches the repository LICENSE", () => {
    const root = join(import.meta.dir, "..", "..", "..")
    expect(readFileSync(join(root, "packages", "v2", "LICENSE"), "utf8")).toBe(
      readFileSync(join(root, "LICENSE"), "utf8"),
    )
  })
})
