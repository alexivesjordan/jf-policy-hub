import { redirect } from "next/navigation";

export default function PriceRedirectPage() {
  redirect("/sales/quote");
}
