import path from "node:path";

import { xdgConfig } from "xdg-basedir";

export function defaultConfigDirs(projectDir: string): string[] {
  return [
    path.join(projectDir, ".opencode"),
    path.join(process.cwd(), ".opencode"),
    xdgConfigOpenCode(),
  ];
}

export function xdgConfigOpenCode(): string {
  return path.join(xdgConfig!, "opencode");
}
