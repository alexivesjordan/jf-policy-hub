export type OrderInstall = { id?: string | null; orderNumber: string; status: string };

/** Same key as ops.install_order_key: case- and whitespace-insensitive, blank is no match. */
export function installOrderKey(orderNumber: string | null | undefined) {
  const key = (orderNumber ?? "").replace(/\s/g, "").toLowerCase();
  return key || null;
}

function sameOrder(install: OrderInstall, orderNumber: string, exceptId?: string | null) {
  if (exceptId && install.id === exceptId) return false;
  const key = installOrderKey(orderNumber);
  return key != null && installOrderKey(install.orderNumber) === key;
}

/** A fresh quote row has no install_id. Booking still has to see the quoting install for that order. */
export function quotingBlocksBook(installs: OrderInstall[], orderNumber: string) {
  return installs.some((install) => install.status === "quoting" && sameOrder(install, orderNumber));
}

/** Opening a subcontractor quote is refused when another live install for the order is quoting or booked. */
export function openBlocked(installs: OrderInstall[], orderNumber: string, currentInstallId: string | null) {
  const others = installs.filter((install) => sameOrder(install, orderNumber, currentInstallId));
  if (others.some((install) => install.status === "quoting")) return "quoting" as const;
  if (others.some((install) => install.status === "booked")) return "booked" as const;
  return null;
}
