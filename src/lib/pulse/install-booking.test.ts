import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PoolResource } from "./availability";
import {
  availableStartDates,
  claimReservation,
  createReservationGate,
  jobSpanDays,
  OPS_INSTALL_FIELDS,
  projectInstall,
  reservationKeys,
  SALES_INSTALL_FIELDS,
  warrantyPrice,
  type InstallRecord,
} from "./install-booking";
import type { JobRequirements } from "./requirements";

const resources: PoolResource[] = [
  { id: "lee", name: "Lee", resourceType: "installer", hasLicence: true, insured: true },
  { id: "sam", name: "Sam", resourceType: "installer", hasLicence: false, insured: true },
  { id: "van", name: "Small van 1", resourceType: "van", hasLicence: false, insured: true },
];

const requirements: JobRequirements = {
  installers: 2,
  licensedDrivers: 1,
  vanSize: "small",
  vanCount: 1,
  stairClimber: false,
};

const record: InstallRecord = {
  id: "job-1",
  orderNumber: "SO-00490",
  goodsNet: 49066.53,
  installPrice: 6692.84,
  warrantyOption: "annual",
  warrantyPrice: 1895,
  startOn: "2026-11-17",
  endOn: "2026-11-18",
  customerName: "Example Customer",
  contactName: "Jane Example",
  contactEmail: "jane.example@example.com",
  contactPhone: "01603 000000",
  siteAddress: "1 Anonymised Road, Ipswich, IP1 4NJ",
  status: "booked",
  bookingRepId: "rep-1",
  bookingRepName: "Alex Ives",
  proposalPath: "ops/quote/proposal.docx",
  serviceQuoteId: "svc-1",
  flags: ["Needs a tail lift"],
  hqBuild: { personHours: 16, lines: [] },
  siteInstall: { days: 2, nights: 1 },
  crew: 2,
  vans: { size: "small", count: 1 },
  resources: [{ id: "lee", name: "Lee" }],
  lines: [{ sku: "JF-C2SE-2", description: "SkiErg", qty: 1 }],
  cin7SaleId: "sale-1",
  cin7CustomerId: "customer-1",
};

describe("instant install booking", () => {
  it("holds engineers and vans for the HQ build days plus the site days", () => {
    assert.deepEqual(jobSpanDays(2, 16, 2), { siteDays: 2, hqDays: 1, totalDays: 3 });
    assert.deepEqual(jobSpanDays(2, 0, 2), { siteDays: 2, hqDays: 0, totalDays: 2 });
  });

  it("offers a start date only when the crew and van are free for the whole job", () => {
    const open = availableStartDates({
      from: "2026-11-17",
      to: "2026-11-19",
      totalDays: 2,
      requirements,
      resources,
      busyByDay: {},
      allowWeekends: false,
      flags: ["This flag must not block the date"],
    });
    assert.deepEqual(open, ["2026-11-17", "2026-11-18", "2026-11-19"]);

    const vanBusyOnFirstDay = availableStartDates({
      from: "2026-11-17",
      to: "2026-11-18",
      totalDays: 2,
      requirements,
      resources,
      busyByDay: { "2026-11-17": ["van"] },
      allowWeekends: false,
    });
    assert.deepEqual(vanBusyOnFirstDay, ["2026-11-18"]);
  });

  it("lets one of two simultaneous bookings claim the van", async () => {
    const store = new Set<string>();
    const gate = createReservationGate();
    const keys = reservationKeys(["van", "lee", "sam"], ["2026-11-17", "2026-11-18"]);
    const [first, second] = await Promise.all([gate(() => claimReservation(store, keys)), gate(() => claimReservation(store, keys))]);
    const won = [first, second].filter((result) => result.ok);
    const lost = [first, second].filter((result) => !result.ok);
    assert.equal(won.length, 1);
    assert.equal(lost.length, 1);
    assert.match(lost[0] && "message" in lost[0] ? lost[0].message : "", /no longer free/);
  });

  it("shows sales the booking and keeps the working detail on the same record for ops", () => {
    const sales = projectInstall(record, "sales");
    const ops = projectInstall(record, "ops");
    assert.deepEqual(Object.keys(sales), [...SALES_INSTALL_FIELDS]);
    assert.deepEqual(Object.keys(ops), [...OPS_INSTALL_FIELDS]);
    assert.equal("flags" in sales, false);
    assert.equal("lines" in sales, false);
    assert.equal("hqBuild" in sales, false);
    assert.equal("cin7SaleId" in sales, false);
    assert.equal(sales.installPrice, 6692.84);
    assert.equal(ops.flags, record.flags);
    record.startOn = "2026-12-01";
    record.endOn = "2026-12-02";
    assert.equal(projectInstall(record, "sales").startOn, "2026-12-01");
    assert.equal(projectInstall(record, "ops").startOn, "2026-12-01");
  });

  it("prices the warranty option the rep chose and refuses one that was not quoted", () => {
    const prices = { annual: 1895, twice: 3495, extension: 2395, annualBundle: 4095, twiceBundle: 5695 };
    assert.equal(warrantyPrice("none", null), null);
    assert.equal(warrantyPrice("annual_bundle", prices), 4095);
    assert.throws(() => warrantyPrice("annual", null), /No warranty was priced/);
  });
});
