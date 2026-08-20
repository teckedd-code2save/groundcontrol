export type ContractSource =
  | "manual"
  | "openapi"
  | "har"
  | "curl"
  | "source"
  | "snapshot";

export type ContractStatus = "draft" | "active";

export interface SourceRoute {
  method: string;
  /** Full request path, always leading with "/". */
  path: string;
  filePath: string;
  line?: number;
  mountPrefix?: string;
  auth?: boolean;
}

export interface HttpProbeResult {
  url: string;
  method: string;
  ok: boolean;
  statusCode?: number;
  latencyMs?: number;
  contentType?: string;
  bodyPreview?: string;
  error?: string;
}

export interface DraftContract {
  component: string;
  name: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
  expectedStatus: number | null;
  expectedBodyContains: string | null;
  source: ContractSource;
  status: ContractStatus;
  evidenceRef: string | null;
  revisionSha: string | null;
  confidence: number;
  probed: HttpProbeResult | null;
}

export interface SourceFile {
  path: string;
  content: string;
}

export interface DiscoverContractsInput {
  component: string;
  baseUrl: string;
  sourceFiles?: SourceFile[];
  seedPaths?: string[];
  existingChecks?: Array<{ method: string; path: string }>;
  revisionSha?: string | null;
  probe?: boolean;
}

export interface DiscoverContractsResult {
  drafts: DraftContract[];
  sourceRoutesFound: number;
  probed: number;
  warnings: string[];
}
