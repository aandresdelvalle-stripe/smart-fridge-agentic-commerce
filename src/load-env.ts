import { loadEnvFile } from "node:process";

try {
  loadEnvFile();
} catch {
  // .env is optional in CI and tests.
}
