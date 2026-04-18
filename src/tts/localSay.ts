import { spawn } from "child_process";

/** macOS-only: speak text; resolves when `say` exits. */
const MAX_SAY_CHARS = 4000;

export function speakWithMacSay(text: string): Promise<void> {
  if (process.platform !== "darwin") {
    return Promise.reject(new Error("Local audio fallback is only supported on macOS."));
  }
  const t = text.length > MAX_SAY_CHARS ? text.slice(0, MAX_SAY_CHARS) : text;
  return new Promise((resolve, reject) => {
    const child = spawn("say", [t], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`say exited with ${code}`));
      }
    });
  });
}
