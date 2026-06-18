import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";

function isUnauthorized(err: unknown): boolean {
  return err instanceof Error && err.message === "Unauthorized";
}

const GCP_REGIONS = [
  { value: "us-central1", label: "us-central1 (Iowa)" },
  { value: "us-east1", label: "us-east1 (South Carolina)" },
  { value: "us-east4", label: "us-east4 (Northern Virginia)" },
  { value: "us-west1", label: "us-west1 (Oregon)" },
  { value: "us-west2", label: "us-west2 (Los Angeles)" },
  { value: "us-west3", label: "us-west3 (Salt Lake City)" },
  { value: "us-west4", label: "us-west4 (Las Vegas)" },
  { value: "us-south1", label: "us-south1 (Dallas)" },
  { value: "northamerica-northeast1", label: "northamerica-northeast1 (Montreal)" },
  { value: "southamerica-east1", label: "southamerica-east1 (São Paulo)" },
  { value: "europe-west1", label: "europe-west1 (Belgium)" },
  { value: "europe-west2", label: "europe-west2 (London)" },
  { value: "europe-west3", label: "europe-west3 (Frankfurt)" },
  { value: "europe-west4", label: "europe-west4 (Netherlands)" },
  { value: "europe-west6", label: "europe-west6 (Zurich)" },
  { value: "europe-west8", label: "europe-west8 (Milan)" },
  { value: "europe-west9", label: "europe-west9 (Paris)" },
  { value: "europe-north1", label: "europe-north1 (Finland)" },
  { value: "asia-east1", label: "asia-east1 (Taiwan)" },
  { value: "asia-east2", label: "asia-east2 (Hong Kong)" },
  { value: "asia-northeast1", label: "asia-northeast1 (Tokyo)" },
  { value: "asia-northeast2", label: "asia-northeast2 (Osaka)" },
  { value: "asia-northeast3", label: "asia-northeast3 (Seoul)" },
  { value: "asia-southeast1", label: "asia-southeast1 (Singapore)" },
  { value: "asia-southeast2", label: "asia-southeast2 (Jakarta)" },
  { value: "asia-south1", label: "asia-south1 (Mumbai)" },
  { value: "asia-south2", label: "asia-south2 (Delhi)" },
  { value: "australia-southeast1", label: "australia-southeast1 (Sydney)" },
  { value: "me-west1", label: "me-west1 (Tel Aviv)" },
];

export async function GET(req: NextRequest) {
  try {
    requireAuth(req);
    return NextResponse.json({ regions: GCP_REGIONS });
  } catch (err: unknown) {
    if (isUnauthorized(err)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
