import { describe, expect, it } from "vitest";
import { getAcsMode } from "../src/agent/acp/mode.js";

describe("ACS integration mode", () => {
  it("defaults to local simulation", () => {
    expect(getAcsMode()).toBe("local");
  });
});
