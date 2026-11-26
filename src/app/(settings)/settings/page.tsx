import { redirect } from "next/navigation";

export default function SettingsHomePage() {
  redirect("/settings/account/profile");
}
