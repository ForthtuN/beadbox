import { execFile, type ExecFileOptions } from "child_process"
import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { promisify } from "util"
import { VERSION_MANAGER_DIRS } from "./tool-paths"

// Augment process.env.PATH with common tool directories so child processes
// (bd, dolt) can find binaries regardless of how the Node process was launched.
// On Linux desktop environments and macOS GUI apps (Tauri sidecar), the inherited
// PATH is often stripped to a minimal set that excludes /usr/local/bin, Homebrew
// paths, and user-local install directories.
const COMMON_TOOL_DIRS = [
  ...VERSION_MANAGER_DIRS,
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/home/linuxbrew/.linuxbrew/bin",
  join(homedir(), "go/bin"),
  join(homedir(), ".local/bin"),
  join(homedir(), ".dolt/bin"),
]

const currentPath = process.env.PATH ?? ""
const currentDirs = new Set(currentPath.split(":").filter(Boolean))
const missing = [...new Set(COMMON_TOOL_DIRS)].filter((d) => !currentDirs.has(d) && existsSync(d))
if (missing.length > 0) {
  process.env.PATH = `${currentPath}:${missing.join(":")}`
}

// Beadbox is a GUI application. On Windows, spawning a console-subsystem
// executable (for example bd.exe during workspace health checks) without
// windowsHide causes a visible terminal to flash on each invocation.
// Hide all subprocess consoles centrally while leaving stdio pipes, error
// handling and the rest of execFile's options unchanged.
const nativeExecFileAsync = promisify(execFile)
export const execFileAsync = ((
  file: string,
  argsOrOptions?: readonly string[] | ExecFileOptions | null,
  options?: ExecFileOptions,
) => {
  const hasArgs = Array.isArray(argsOrOptions) || argsOrOptions == null
  const args = hasArgs ? (argsOrOptions as readonly string[] | undefined) : undefined
  const opts = hasArgs ? options : (argsOrOptions as ExecFileOptions)
  return nativeExecFileAsync(file, args, { ...opts, windowsHide: true })
}) as typeof nativeExecFileAsync
export { existsSync } from "fs"
