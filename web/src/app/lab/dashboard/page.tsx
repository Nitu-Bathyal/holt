// PROTOTYPE, don't merge. /lab/dashboard shows the proposed signed-in app
// (docs/design/DASHBOARD.md) on made-up data, so the direction can be clicked
// through on staging before any real page changes. Throwaway: the real pages
// get rebuilt one PR at a time once a direction is chosen.
import type { Metadata } from "next";
import { DashboardLab } from "./_parts/lab";
import "./dashboard.css";

export const metadata: Metadata = {
  title: "Lab: the signed-in app",
  robots: { index: false, follow: false },
};

export default function DashboardLabPage() {
  return <DashboardLab />;
}
