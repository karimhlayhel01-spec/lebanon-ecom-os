import { describe, expect, it } from "vitest";
import { WORKSPACE_CASCADE_DELETE_ORDER } from "@/lib/account/delete-user";
import { WORKSPACE_CASCADE_TABLES } from "@/lib/account/cascade-order";

describe("WORKSPACE_CASCADE_DELETE_ORDER re-export", () => {
  it("points at the shared cascade module", () => {
    expect(WORKSPACE_CASCADE_DELETE_ORDER).toBe(WORKSPACE_CASCADE_TABLES);
  });
});
