import { notFound } from "next/navigation";
import { ComponentLab } from "@/components/ui/ComponentLab";

export default function UiLabPage() {
  if (process.env.NODE_ENV === "production" && process.env.GC_ENABLE_UI_LAB !== "true") {
    notFound();
  }
  return <ComponentLab />;
}

