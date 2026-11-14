export type OrderInstall = { id?: string | null; orderNumber: string; status: string };

/** Same key as ops.install_order_key: case, whitespace, and zero-width characters do not count. */
const ORDER_KEY_GAP = /[\s\u200b-\u200d\u2060\ufeff\u00a0]/g;

export function installOrderKey(orderNumber: string | null | undefined) {
  const key = (orderNumber ?? "").replace(ORDER_KEY_GAP, "").toLowerCase();
  return key || null;
}

function sameOrder(install: OrderInstall, orderNumber: string, exceptId?: string | null) {
  if (exceptId && install.id === exceptId) return false;
  const key = installOrderKey(orderNumber);
  return key != null && installOrderKey(install.orderNumber) === key;
}

/** Any other live install blocks a new book. The quote's own install does not, except while it is quoting. */
export function bookConflict(installs: OrderInstall[], orderNumber: string, ownInstallId: string | null) {
  const own = installs.find((install) => ownInstallId && install.id === ownInstallId);
  if (own?.status === "quoting") return "quoting" as const;
  const others = installs.filter((install) => install.status !== "cancelled" && install.status !== "completed" && sameOrder(install, orderNumber, ownInstallId));
  if (others.some((install) => install.status === "quoting")) return "quoting" as const;
  if (others.length > 0) return "booked" as const;
  return null;
}

/** Opening a subcontractor quote is refused when another live install for the order is quoting or booked. */
export function openBlocked(installs: OrderInstall[], orderNumber: string, currentInstallId: string | null) {
  const others = installs.filter((install) => sameOrder(install, orderNumber, currentInstallId));
  if (others.some((install) => install.status === "quoting")) return "quoting" as const;
  if (others.some((install) => install.status === "booked")) return "booked" as const;
  return null;
}
