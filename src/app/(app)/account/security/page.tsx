import { redirect } from "next/navigation";

export default function SecurityRedirect() {
  redirect("/settings/account/security");
}
