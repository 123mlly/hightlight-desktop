import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const staticSrc = join(root, "static");
if (existsSync(staticSrc)) {
  mkdirSync(join(root, "dist"), { recursive: true });
  cpSync(staticSrc, join(root, "dist", "static"), { recursive: true });
}
