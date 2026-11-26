import { redirect } from "next/navigation";

export default function NameRedirect() {
  redirect("/settings/account/profile");
}
