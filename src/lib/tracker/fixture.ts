import { buildPublicModel } from "@/lib/tracker/model";
import type { TrackerSnapshot } from "@/lib/tracker/snapshot";
import type { StaffLink } from "@/lib/tracker/load-types";

/** 32 bytes, fixture mode only. Never accepted unless PULSE_FIXTURE=1. */
export const FIXTURE_TRACK_TOKEN = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";

export const FIXTURE_PHOTO = "11111111-1111-4111-8111-111111111111";

const FIXTURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const FIXTURE_ORDER = "SO-00490";

export function fixtureSnapshot(): TrackerSnapshot {
  return {
    orderNumber: FIXTURE_ORDER,
    saleId: "d06fa5e7-17ee-4052-8c9d-1c241bbc5605",
    customerName: "Example Customer",
    status: "ORDERED",
    orderStatus: "AUTHORISED",
    pickingStatus: "PICKED",
    packingStatus: "PACKED",
    shippingStatus: "SHIPPED",
    fulfilmentStatus: "FULFILLED",
    shipBy: "2026-12-18T00:00:00",
    requiredBy: null,
    carrier: "FedEx",
    trackingNumbers: ["EX123456789"],
    items: [
      { name: "Concept2 SkiErg - Including PM5 Monitor", quantity: 1 },
      { name: "Concept2 SkiErg Floor Stand", quantity: 1 },
    ],
  };
}

export function fixturePublicModel(token = FIXTURE_TRACK_TOKEN) {
  return buildPublicModel({
    snapshot: fixtureSnapshot(),
    install: { status: "booked", startOn: "2026-12-03" },
    photos: [{ id: FIXTURE_PHOTO, caption: "Packed and checked", src: `/api/track/media/${token}/${FIXTURE_PHOTO}` }],
  });
}

export function fixtureStaffLinks(): StaffLink[] {
  return [
    {
      id: "22222222-2222-4222-8222-222222222222",
      orderNumber: FIXTURE_ORDER,
      status: "active",
      createdAt: "2026-11-20T09:30:00.000Z",
      expiresOn: "2027-05-19T09:30:00.000Z",
      viewCount: 3,
      lastViewedAt: "2026-11-26T15:04:00.000Z",
      photos: [
        {
          id: FIXTURE_PHOTO,
          caption: "Packed and checked",
          visible: true,
          sortOrder: 1,
          url: FIXTURE_PNG,
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          caption: "Corner guard",
          visible: false,
          sortOrder: 2,
          url: FIXTURE_PNG,
        },
      ],
    },
  ];
}

export function fixturePngBytes() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}
