import { describe, expect, it } from "vitest";
import {
  canShowBackupInsurance,
  countInFlightSpareSamples,
  findFirstApprovedSample,
  findInFlightSample,
  hasSampleInFlight,
  isSampleInFlight,
  listInFlightSamples,
  listInFlightSpareSamples,
  listWarmSparesForSwitch,
  MAX_SPARE_SAMPLES_IN_FLIGHT,
  resolveSupplierCardSampleMode,
  resolveWorkingPathSupplierId,
  sampleFlightGate,
  shouldPatchJourneySampleStatus,
  supplierCardSampleCta,
} from "@/lib/supplier/sample-flight";

describe("isSampleInFlight", () => {
  it("requested and received are in flight", () => {
    expect(isSampleInFlight("requested")).toBe(true);
    expect(isSampleInFlight("received")).toBe(true);
  });

  it("approved is NOT in flight", () => {
    expect(isSampleInFlight("approved")).toBe(false);
  });

  it("rejected / replace are not in flight", () => {
    expect(isSampleInFlight("rejected")).toBe(false);
    expect(isSampleInFlight("replace")).toBe(false);
  });
});

describe("findInFlightSample / hasSampleInFlight / listInFlightSamples", () => {
  it("ignores approved and picks latest in-flight", () => {
    const rows = [
      { id: "a", status: "approved" },
      { id: "b", status: "requested" },
      { id: "c", status: "rejected" },
    ];
    expect(findInFlightSample(rows)?.id).toBe("b");
    expect(hasSampleInFlight(rows)).toBe(true);
    expect(listInFlightSamples(rows).map((r) => r.id)).toEqual(["b"]);
  });

  it("returns undefined when only approved exists", () => {
    const rows = [{ id: "a", status: "approved" }];
    expect(findInFlightSample(rows)).toBeUndefined();
    expect(hasSampleInFlight(rows)).toBe(false);
  });

  it("lists multiple in-flight samples oldest→newest", () => {
    const rows = [
      { id: "a", status: "approved" },
      { id: "b", status: "requested" },
      { id: "c", status: "received" },
      { id: "d", status: "rejected" },
    ];
    expect(listInFlightSamples(rows).map((r) => r.id)).toEqual(["b", "c"]);
    expect(findInFlightSample(rows)?.id).toBe("c");
  });
});

describe("spare in-flight count + sampleFlightGate", () => {
  const path = "path-1";

  it("counts only non-path in-flight as spares", () => {
    const rows = [
      { supplierId: path, status: "approved" },
      { supplierId: "s1", status: "requested" },
      { supplierId: "s2", status: "received" },
      { supplierId: "s3", status: "approved" },
    ];
    expect(countInFlightSpareSamples(rows, path)).toBe(2);
    expect(listInFlightSpareSamples(rows, path).map((r) => r.supplierId)).toEqual(
      ["s1", "s2"],
    );
  });

  it("before path approve: blocks second sample while any in flight", () => {
    expect(
      sampleFlightGate({
        sampleApproved: false,
        sampleRows: [{ supplierId: "a", status: "requested" }],
        pathSupplierId: null,
        targetSupplierId: "b",
      }),
    ).toBe("sample_in_flight");
    expect(
      sampleFlightGate({
        sampleApproved: false,
        sampleRows: [],
        pathSupplierId: null,
        targetSupplierId: "b",
      }),
    ).toBe("ok");
  });

  it("after path approve: allows parallel spares up to cap", () => {
    const two = [
      { supplierId: path, status: "approved" },
      { supplierId: "s1", status: "requested" },
      { supplierId: "s2", status: "received" },
    ];
    expect(
      sampleFlightGate({
        sampleApproved: true,
        sampleRows: two,
        pathSupplierId: path,
        targetSupplierId: "s3",
      }),
    ).toBe("ok");

    const three = [
      ...two,
      { supplierId: "s3", status: "requested" },
    ];
    expect(countInFlightSpareSamples(three, path)).toBe(
      MAX_SPARE_SAMPLES_IN_FLIGHT,
    );
    expect(
      sampleFlightGate({
        sampleApproved: true,
        sampleRows: three,
        pathSupplierId: path,
        targetSupplierId: "s4",
      }),
    ).toBe("spare_cap");
  });

  it("after path approve: blocks same supplier already in flight", () => {
    expect(
      sampleFlightGate({
        sampleApproved: true,
        sampleRows: [
          { supplierId: path, status: "approved" },
          { supplierId: "s1", status: "requested" },
        ],
        pathSupplierId: path,
        targetSupplierId: "s1",
      }),
    ).toBe("sample_in_flight");
  });
});

describe("shouldPatchJourneySampleStatus", () => {
  it("patches only before path approve", () => {
    expect(shouldPatchJourneySampleStatus(false)).toBe(true);
    expect(shouldPatchJourneySampleStatus(true)).toBe(false);
  });
});

describe("findFirstApprovedSample", () => {
  it("keeps first approved when a later backup is also approved", () => {
    const rows = [
      { id: "primary", status: "approved" },
      { id: "backup", status: "approved" },
    ];
    expect(findFirstApprovedSample(rows)?.id).toBe("primary");
  });
});

describe("resolveWorkingPathSupplierId", () => {
  it("prefers reorder path, then reorder supplier, then first approved", () => {
    expect(
      resolveWorkingPathSupplierId({
        reorderPathSupplierId: "path",
        reorderSupplierId: "reorder",
        firstApprovedSupplierId: "first",
      }),
    ).toBe("path");
    expect(
      resolveWorkingPathSupplierId({
        reorderPathSupplierId: null,
        reorderSupplierId: "reorder",
        firstApprovedSupplierId: "first",
      }),
    ).toBe("reorder");
    expect(
      resolveWorkingPathSupplierId({
        reorderPathSupplierId: null,
        reorderSupplierId: null,
        firstApprovedSupplierId: "first",
      }),
    ).toBe("first");
  });

  it("returns null when no path yet (hub shows none)", () => {
    expect(
      resolveWorkingPathSupplierId({
        reorderPathSupplierId: null,
        reorderSupplierId: null,
        firstApprovedSupplierId: null,
      }),
    ).toBeNull();
  });

  it("after path switch uses reorderPathSupplierId (not spare-only first approved)", () => {
    expect(
      resolveWorkingPathSupplierId({
        reorderPathSupplierId: "warm-spare",
        reorderSupplierId: null,
        firstApprovedSupplierId: "original-primary",
      }),
    ).toBe("warm-spare");
  });
});

/** Mirrors reportSupplierCantFulfill path resolution when path fields are cleared. */
describe("cant-fulfill path fallback (first approved, not latest spare)", () => {
  it("path-null + two approved → resolves original, not warmed spare", () => {
    const sampleRows = [
      { supplierId: "original-path", status: "approved" },
      { supplierId: "warmed-spare", status: "approved" },
    ];
    const firstApproved = findFirstApprovedSample(sampleRows);
    const pathId = resolveWorkingPathSupplierId({
      reorderPathSupplierId: null,
      reorderSupplierId: null,
      firstApprovedSupplierId: firstApproved?.supplierId ?? null,
    });
    expect(pathId).toBe("original-path");
    expect(pathId).not.toBe("warmed-spare");
  });

  it("double-report after path cleared: original already unavailable → spare stays free", () => {
    const sampleRows = [
      { supplierId: "original-path", status: "approved" },
      { supplierId: "warmed-spare", status: "approved" },
    ];
    // First can’t-fulfill marked original and cleared path fields.
    const unavailable: Record<string, { reason: string; at: string }> = {
      "original-path": { reason: "other", at: "t1" },
    };
    const firstApproved = findFirstApprovedSample(sampleRows);
    const pathId = resolveWorkingPathSupplierId({
      reorderPathSupplierId: null,
      reorderSupplierId: null,
      firstApprovedSupplierId: firstApproved?.supplierId ?? null,
    });
    expect(pathId).toBe("original-path");
    // Call site returns no_path_supplier — must not mark spare.
    expect(unavailable[pathId!]).toBeTruthy();
    expect(unavailable["warmed-spare"]).toBeUndefined();
  });
});

describe("canShowBackupInsurance", () => {
  it("available after approve on post-approve spine", () => {
    expect(
      canShowBackupInsurance({
        sampleApproved: true,
        primaryState: "selling",
      }),
    ).toBe(true);
    expect(
      canShowBackupInsurance({
        sampleApproved: true,
        primaryState: "sample_approved",
      }),
    ).toBe(true);
  });

  it("hidden before first approve", () => {
    expect(
      canShowBackupInsurance({
        sampleApproved: false,
        primaryState: "supplier_sample",
      }),
    ).toBe(false);
  });
});

describe("resolveSupplierCardSampleMode", () => {
  it("Mode A while interactive shortlist or before approve", () => {
    expect(
      resolveSupplierCardSampleMode({
        sampleApproved: false,
        showShortlist: true,
      }),
    ).toBe("first_sample");
    expect(
      resolveSupplierCardSampleMode({
        sampleApproved: false,
        showShortlist: false,
      }),
    ).toBe("first_sample");
  });

  it("Mode B after approve when shortlist is not first-pick", () => {
    expect(
      resolveSupplierCardSampleMode({
        sampleApproved: true,
        showShortlist: false,
      }),
    ).toBe("insurance");
  });
});

describe("supplierCardSampleCta", () => {
  const base = {
    sampleInFlight: false,
    pathSupplierId: "path-1",
    sameSourceAsPath: true,
  };

  it("Mode A: Request sample on primary and backup", () => {
    expect(
      supplierCardSampleCta({
        ...base,
        mode: "first_sample",
        supplierId: "path-1",
        role: "primary",
      }).kind,
    ).toBe("request_sample");
    expect(
      supplierCardSampleCta({
        ...base,
        mode: "first_sample",
        supplierId: "b1",
        role: "backup",
      }).kind,
    ).toBe("request_sample");
  });

  it("Mode B: path card has no insurance button", () => {
    expect(
      supplierCardSampleCta({
        ...base,
        mode: "insurance",
        supplierId: "path-1",
        role: "primary",
      }).kind,
    ).toBe("none");
  });

  it("Mode B: eligible cold backup gets Request backup sample", () => {
    expect(
      supplierCardSampleCta({
        ...base,
        mode: "insurance",
        supplierId: "b1",
        role: "backup",
      }).kind,
    ).toBe("request_backup_sample");
  });

  it("Mode B: non-working primary also gets spare CTA", () => {
    expect(
      supplierCardSampleCta({
        ...base,
        mode: "insurance",
        supplierId: "p2",
        role: "primary",
      }).kind,
    ).toBe("request_backup_sample");
  });

  it("Mode B: never shows early Request sample label", () => {
    expect(
      supplierCardSampleCta({
        ...base,
        mode: "insurance",
        supplierId: "b1",
        role: "backup",
      }).kind,
    ).not.toBe("request_sample");
  });

  it("Mode B: already-warm / wrong source / unavailable → none", () => {
    expect(
      supplierCardSampleCta({
        ...base,
        mode: "insurance",
        supplierId: "b1",
        role: "backup",
        alreadyWarm: true,
      }).kind,
    ).toBe("none");
    expect(
      supplierCardSampleCta({
        ...base,
        mode: "insurance",
        supplierId: "b1",
        role: "backup",
        sameSourceAsPath: false,
      }).kind,
    ).toBe("none");
    expect(
      supplierCardSampleCta({
        ...base,
        mode: "insurance",
        supplierId: "b1",
        role: "backup",
        unavailable: true,
      }).kind,
    ).toBe("none");
  });

  it("Mode A: in-flight blanks all cards", () => {
    expect(
      supplierCardSampleCta({
        ...base,
        mode: "first_sample",
        sampleInFlight: true,
        supplierId: "b1",
        role: "backup",
      }).kind,
    ).toBe("none");
  });

  it("Mode B: other cards stay requestable while a spare is in flight", () => {
    expect(
      supplierCardSampleCta({
        ...base,
        mode: "insurance",
        sampleInFlight: true,
        supplierId: "b2",
        role: "backup",
      }).kind,
    ).toBe("request_backup_sample");
  });

  it("Mode B: blanks only the supplier that already has an in-flight sample", () => {
    expect(
      supplierCardSampleCta({
        ...base,
        mode: "insurance",
        supplierId: "b1",
        role: "backup",
        supplierSampleInFlight: true,
      }).kind,
    ).toBe("none");
    expect(
      supplierCardSampleCta({
        ...base,
        mode: "insurance",
        supplierId: "b2",
        role: "backup",
        supplierSampleInFlight: false,
      }).kind,
    ).toBe("request_backup_sample");
  });

  it("Mode B: spare cap blanks remaining CTAs", () => {
    expect(
      supplierCardSampleCta({
        ...base,
        mode: "insurance",
        supplierId: "b4",
        role: "backup",
        spareCapReached: true,
      }).kind,
    ).toBe("none");
  });
});

describe("listWarmSparesForSwitch", () => {
  it("yellow list is warm-only and includes warmed non-backup ranks", () => {
    const rows = [
      { id: "w", warm: true, role: "backup" },
      { id: "c", warm: false, role: "backup" },
      { id: "p2", warm: true, role: "primary" },
    ];
    expect(listWarmSparesForSwitch(rows).map((r) => r.id)).toEqual([
      "w",
      "p2",
    ]);
  });
});
