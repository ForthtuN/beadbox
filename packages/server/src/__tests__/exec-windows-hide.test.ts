import { describe, expect, test } from "bun:test"
import { execFileAsync } from "../lib/exec"

describe("GUI-safe subprocess execution", () => {
  test("captures stdout and stderr without changing how commands are run", async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["-e", 'process.stdout.write("ready"); process.stderr.write("diagnostic")'],
      { timeout: 5000 },
    )
    expect(stdout).toBe("ready")
    expect(stderr).toBe("diagnostic")
  })

  test.skipIf(process.platform !== "win32")(
    "still captures Windows console command output",
    async () => {
      const { stdout } = await execFileAsync(
        process.env.ComSpec || "cmd.exe",
        ["/d", "/c", "echo beadbox-hidden"],
        { timeout: 5000 },
      )
      expect(stdout.trim()).toBe("beadbox-hidden")
    },
  )
})
