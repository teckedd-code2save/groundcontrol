import { connection } from "next/server";
import { isDesktopMode } from "@/lib/runtime";
import OnboardingClient from "./OnboardingClient";

export default async function OnboardingPage() {
  // The same release image supports desktop and server installations.
  // Read its runtime mode per request, rather than baking it into the build.
  await connection();
  return <OnboardingClient localDesktop={isDesktopMode()} />;
}
