import { describe, expect, it } from "vitest";
import {
  bridgeCoachingForSource,
  canReorderWithSupplier,
  evaluateCrisisSampleSkip,
  listReorderBackupCandidates,
  markSupplierUnavailable,
  planCancelReorderOrdered,
  shouldCoachWarmBackup,
} from "@/lib/supplier/reorder-escape";

describe("listReorderBackupCandidates (spares)", () => {
  const suppliers = [
    {
      id: "p1",
      name: "Primary working",
      role: "primary",
      source: "import" as const,
      moq: 100,
      unitPrice: 5,
    },
    {
      id: "p2",
      name: "Other primary",
      role: "primary",
      source: "import" as const,
      moq: 80,
      unitPrice: 5.2,
    },
    {
      id: "b1",
      name: "Warm backup",
      role: "backup",
      source: "import" as const,
      moq: 50,
      unitPrice: 5.5,
    },
    {
      id: "b2",
      name: "Cold backup",
      role: "backup",
      source: "import" as const,
      moq: 40,
      unitPrice: 6,
    },
    {
      id: "bLocal",
      name: "Local backup",
      role: "backup",
      source: "local" as const,
      moq: 20,
      unitPrice: 8,
    },
  ];

  it("lists same-source non-path spares including other primaries", () => {
    const list = listReorderBackupCandidates({
      suppliers,
      pathSource: "import",
      pathSupplierId: "p1",
      approvedSampleSupplierIds: new Set(["p1", "b1", "p2"]),
      unavailable: {},
    });
    expect(list.map((c) => c.id).sort()).toEqual(["b1", "b2", "p2"]);
    expect(list.find((c) => c.id === "p1")).toBeUndefined();
    expect(list.find((c) => c.id === "b1")?.warm).toBe(true);
    expect(list.find((c) => c.id === "p2")?.warm).toBe(true);
    expect(list.find((c) => c.id === "p2")?.role).toBe("primary");
    expect(list.find((c) => c.id === "b2")?.warm).toBe(false);
    expect(list.some((c) => c.id === "bLocal")).toBe(false);
  });

  it("excludes unavailable spares", () => {
    const list = listReorderBackupCandidates({
      suppliers,
      pathSource: "import",
      pathSupplierId: "p1",
      approvedSampleSupplierIds: new Set(),
      unavailable: {
        b1: { reason: "no_stock", at: "2026-01-01" },
        p2: { reason: "price", at: "2026-01-01" },
      },
    });
    expect(list.map((c) => c.id)).toEqual(["b2"]);
  });
});

describe("evaluateCrisisSampleSkip", () => {
  it("blocks beginners on cold; allows some/experienced with ack", () => {
    expect(
      evaluateCrisisSampleSkip({ experience: "beginner", warm: false }),
    ).toEqual({ ok: false, error: "beginner_no_skip" });
    expect(
      evaluateCrisisSampleSkip({ experience: "some", warm: false }),
    ).toEqual({ ok: true, requiresAck: true });
    expect(
      evaluateCrisisSampleSkip({ experience: "experienced", warm: false }),
    ).toEqual({ ok: true, requiresAck: true });
  });

  it("rejects skip when already warm", () => {
    expect(
      evaluateCrisisSampleSkip({ experience: "experienced", warm: true }),
    ).toEqual({ ok: false, error: "not_cold" });
  });
});

describe("planCancelReorderOrdered", () => {
  it("resets ordered → idle while selling", () => {
    expect(
      planCancelReorderOrdered({
        primaryState: "selling",
        reorderStatus: "ordered",
      }),
    ).toEqual({ ok: true, nextStatus: "idle" });
  });

  it("rejects when not selling or not ordered", () => {
    expect(
      planCancelReorderOrdered({
        primaryState: "batch_ordered",
        reorderStatus: "ordered",
      }),
    ).toEqual({ ok: false, error: "not_selling" });
    expect(
      planCancelReorderOrdered({
        primaryState: "selling",
        reorderStatus: "idle",
      }),
    ).toEqual({ ok: false, error: "not_ordered" });
  });
});

describe("canReorderWithSupplier", () => {
  it("allows approved or crisis-skip; blocks unavailable", () => {
    expect(
      canReorderWithSupplier({
        supplierId: "b1",
        approvedSampleSupplierIds: new Set(["b1"]),
        crisisSkipSupplierIds: new Set(),
        unavailable: {},
      }),
    ).toBe(true);
    expect(
      canReorderWithSupplier({
        supplierId: "b2",
        approvedSampleSupplierIds: new Set(),
        crisisSkipSupplierIds: new Set(["b2"]),
        unavailable: {},
      }),
    ).toBe(true);
    expect(
      canReorderWithSupplier({
        supplierId: "b1",
        approvedSampleSupplierIds: new Set(["b1"]),
        crisisSkipSupplierIds: new Set(),
        unavailable: { b1: { reason: "no_stock", at: "x" } },
      }),
    ).toBe(false);
  });

  it("shouldCoachWarmBackup when no warm yet", () => {
    expect(
      shouldCoachWarmBackup({
        primaryState: "selling",
        sampleApproved: true,
        hasWarmBackup: false,
      }),
    ).toBe(true);
    expect(
      shouldCoachWarmBackup({
        primaryState: "selling",
        sampleApproved: true,
        hasWarmBackup: true,
      }),
    ).toBe(false);
  });
});

describe("canShowBackupInsurance stays after warm", () => {
  it("remains available even when a warm backup exists", async () => {
    const { canShowBackupInsurance } = await import(
      "@/lib/supplier/sample-flight"
    );
    expect(
      canShowBackupInsurance({
        sampleApproved: true,
        primaryState: "selling",
      }),
    ).toBe(true);
  });
});

describe("bridgeCoachingForSource", () => {
  it("adds local bridge for local/both", () => {
    expect(bridgeCoachingForSource("import").localBridge).toBe(false);
    expect(bridgeCoachingForSource("local").localBridge).toBe(true);
    expect(bridgeCoachingForSource("both").localBridge).toBe(true);
    expect(markSupplierUnavailable({}, "x", "no_stock", "t").x.reason).toBe(
      "no_stock",
    );
  });
});
