// ─── Types ────────────────────────────────────────────────────────────────────

export interface TierCertificationParams {
  generator_config:               string;
  ups_topology:                   string;
  cooling_redundancy:             string;
  power_paths:                    number;
  fuel_runtime_hours:             number;
  transfer_switch_type:           string;
  has_concurrent_maintainability: boolean;
  has_fault_tolerance:            boolean;
  target_tier:                    "Tier I" | "Tier II" | "Tier III" | "Tier IV";
}

export interface TierCertificationResult {
  workflow:  string;
  target:    string;
  timestamp: string;
  results:   AgentOutput & { duration_ms: number };
}

interface TierDetails {
  description:     string;
  uptime_pct:      number;
  downtime_hrs_yr: number;
}

interface Gap {
  gap:                      string;
  requirement:              string;
  remediation:              string;
  estimated_cost_low_usd:  number;
  estimated_cost_high_usd: number;
  priority:                 string;
}

interface GapAnalysis {
  current_tier:                    string;
  target_tier:                     string;
  already_qualifies:               boolean;
  gap_count:                       number;
  gaps:                            Gap[];
  total_remediation_cost_low_usd:  number;
  total_remediation_cost_high_usd: number;
}

interface AgentOutput {
  current_tier:               string;
  target_tier:                string;
  qualifies_for_target:       boolean;
  readiness_score_pct:        number;
  current_tier_details:       TierDetails;
  target_tier_details:        TierDetails;
  assessed_capabilities:      Record<string, unknown>;
  gap_analysis:               GapAnalysis;
  priority_remediation_steps: string[];
  total_remediation_cost_low_usd:  number;
  total_remediation_cost_high_usd: number;
  disclaimer:                 string;
}

// ─── Tier Requirements ────────────────────────────────────────────────────────
// Based on Uptime Institute Tier Standard: Topology (2017 edition)

interface TierReq {
  min_power_paths:           number;
  requires_n_plus_1:         boolean;
  requires_concurrent_maint: boolean;
  requires_fault_tolerance:  boolean;
  min_fuel_runtime_hours:    number;
  ats_required:              boolean;
  sts_required:              boolean;
  uptime_pct:                number;
  downtime_hrs_yr:           number;
  description:               string;
}

const TIER_REQUIREMENTS: Record<string, TierReq> = {
  "Tier I": {
    min_power_paths:           1,
    requires_n_plus_1:         false,
    requires_concurrent_maint: false,
    requires_fault_tolerance:  false,
    min_fuel_runtime_hours:    12,
    ats_required:              true,
    sts_required:              false,
    uptime_pct:                99.671,
    downtime_hrs_yr:           28.8,
    description: "Basic site infrastructure with no redundancy",
  },
  "Tier II": {
    min_power_paths:           1,
    requires_n_plus_1:         true,
    requires_concurrent_maint: false,
    requires_fault_tolerance:  false,
    min_fuel_runtime_hours:    12,
    ats_required:              true,
    sts_required:              false,
    uptime_pct:                99.741,
    downtime_hrs_yr:           22.0,
    description: "Redundant capacity components, single distribution path",
  },
  "Tier III": {
    min_power_paths:           2,
    requires_n_plus_1:         true,
    requires_concurrent_maint: true,
    requires_fault_tolerance:  false,
    min_fuel_runtime_hours:    72,
    ats_required:              true,
    sts_required:              false,
    uptime_pct:                99.982,
    downtime_hrs_yr:           1.6,
    description: "Multiple paths, concurrent maintainability (one active path)",
  },
  "Tier IV": {
    min_power_paths:           2,
    requires_n_plus_1:         true,
    requires_concurrent_maint: true,
    requires_fault_tolerance:  true,
    min_fuel_runtime_hours:    96,
    ats_required:              true,
    sts_required:              true,
    uptime_pct:                99.995,
    downtime_hrs_yr:           0.44,
    description: "Fault tolerant — all components 2N, dual active paths",
  },
};

// Gap cost estimates (USD) — typical data center retrofit costs
const GAP_COSTS: Record<string, [number, number, string]> = {
  add_redundant_generator:     [150_000, 400_000, "Add N+1 generator with ATS"],
  upgrade_ups_topology:        [80_000,  300_000, "Upgrade UPS to 2N topology"],
  add_redundant_cooling:       [120_000, 350_000, "Add redundant cooling units"],
  add_second_power_path:       [200_000, 600_000, "Install independent second power distribution path"],
  extend_fuel_storage_to_72h:  [30_000,  100_000, "Expand fuel storage to 72-hour runtime"],
  extend_fuel_storage_to_96h:  [45_000,  130_000, "Expand fuel storage to 96-hour runtime"],
  implement_concurrent_maint:  [50_000,  200_000, "Redesign topology for concurrent maintainability"],
  implement_fault_tolerance:   [300_000, 800_000, "Upgrade all systems to 2N fault-tolerant configuration"],
  add_sts:                     [40_000,  120_000, "Install Static Transfer Switches for sub-cycle failover"],
  upgrade_transfer_switch:     [15_000,  50_000,  "Upgrade manual/ATS to STS transfer switch"],
};

const TIER_ORDER = ["Tier I", "Tier II", "Tier III", "Tier IV"] as const;

// ─── Business logic ───────────────────────────────────────────────────────────

function detectNPlus1(config: string): boolean {
  const u = config.toUpperCase();
  return ["N+1", "2N", "N+2", "REDUNDANT", "DUAL"].some((k) => u.includes(k));
}

function detect2N(config: string): boolean {
  return config.toUpperCase().includes("2N");
}

function achievedTier(
  powerPaths: number,
  hasNPlus1: boolean,
  hasConcurrent: boolean,
  hasFaultTolerance: boolean,
  fuelHours: number,
  hasSts: boolean,
): string {
  if (powerPaths >= 2 && hasNPlus1 && hasConcurrent && hasFaultTolerance && fuelHours >= 96 && hasSts)
    return "Tier IV";
  if (powerPaths >= 2 && hasNPlus1 && hasConcurrent && fuelHours >= 72)
    return "Tier III";
  if (hasNPlus1 && fuelHours >= 12)
    return "Tier II";
  return "Tier I";
}

function buildGapAnalysis(
  currentTier: string,
  targetTier: string,
  p: {
    power_paths: number;
    has_n_plus_1: boolean;
    has_concurrent: boolean;
    has_fault_tolerance: boolean;
    fuel_hours: number;
    has_sts: boolean;
    cooling_redundancy: string;
  },
): GapAnalysis {
  const req = TIER_REQUIREMENTS[targetTier];
  const gaps: Gap[] = [];
  let costLow = 0;
  let costHigh = 0;

  const addGap = (key: string, gapText: string, requirement: string, priority: string) => {
    const [low, high, remediation] = GAP_COSTS[key];
    gaps.push({ gap: gapText, requirement, remediation, estimated_cost_low_usd: low, estimated_cost_high_usd: high, priority });
    costLow  += low;
    costHigh += high;
  };

  if (p.power_paths < req.min_power_paths)
    addGap("add_second_power_path",
      `Insufficient independent power paths (have ${p.power_paths}, need ${req.min_power_paths})`,
      `${req.min_power_paths} independent power distribution paths`, "HIGH");

  if (req.requires_n_plus_1 && !p.has_n_plus_1)
    addGap("add_redundant_generator",
      "Generator and/or UPS lacks N+1 redundancy",
      "All critical systems must have N+1 redundant capacity", "HIGH");

  const coolingUpper = p.cooling_redundancy.toUpperCase();
  if (req.requires_n_plus_1 && !coolingUpper.includes("N+1") && !coolingUpper.includes("2N"))
    addGap("add_redundant_cooling",
      "Cooling system does not meet N+1 redundancy",
      "Cooling must be N+1 or 2N redundant", "HIGH");

  if (req.requires_concurrent_maint && !p.has_concurrent)
    addGap("implement_concurrent_maint",
      "Topology does not support concurrent maintainability",
      "Any component can be removed for maintenance without IT load impact", "HIGH");

  if (req.requires_fault_tolerance && !p.has_fault_tolerance)
    addGap("implement_fault_tolerance",
      "Facility is not fault tolerant (2N required for Tier IV)",
      "All infrastructure must be 2N — a single failure cannot affect IT load", "CRITICAL");

  if (p.fuel_hours < req.min_fuel_runtime_hours) {
    const key = req.min_fuel_runtime_hours >= 96 ? "extend_fuel_storage_to_96h" : "extend_fuel_storage_to_72h";
    addGap(key,
      `Fuel runtime ${p.fuel_hours}h is below ${req.min_fuel_runtime_hours}h minimum`,
      `Minimum ${req.min_fuel_runtime_hours} hours of on-site fuel storage`, "MEDIUM");
  }

  if (req.sts_required && !p.has_sts)
    addGap("add_sts",
      "No Static Transfer Switches (STS) installed",
      "Tier IV requires STS for sub-cycle power path switchover", "HIGH");

  const currentIdx = TIER_ORDER.indexOf(currentTier as typeof TIER_ORDER[number]);
  const targetIdx  = TIER_ORDER.indexOf(targetTier  as typeof TIER_ORDER[number]);

  return {
    current_tier:                   currentTier,
    target_tier:                    targetTier,
    already_qualifies:              currentIdx >= targetIdx,
    gap_count:                      gaps.length,
    gaps,
    total_remediation_cost_low_usd:  costLow,
    total_remediation_cost_high_usd: costHigh,
  };
}

function readinessScore(currentTier: string, targetTier: string, gapCount: number): number {
  const cIdx = TIER_ORDER.indexOf(currentTier as typeof TIER_ORDER[number]);
  const tIdx = TIER_ORDER.indexOf(targetTier  as typeof TIER_ORDER[number]);
  if (cIdx >= tIdx) return 100.0;

  const maxGaps: Record<string, number> = {
    "Tier I→Tier II":   3,
    "Tier I→Tier III":  6,
    "Tier I→Tier IV":   8,
    "Tier II→Tier III": 4,
    "Tier II→Tier IV":  7,
    "Tier III→Tier IV": 4,
  };
  const key = `${currentTier}→${targetTier}`;
  const max = maxGaps[key] ?? 5;
  return Math.round(Math.max(0, (1 - gapCount / max) * 100) * 10) / 10;
}

function prioritySteps(gaps: Gap[]): string[] {
  const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return [...gaps]
    .sort((a, b) => (order[a.priority] ?? 99) - (order[b.priority] ?? 99))
    .map((g) =>
      `[${g.priority}] ${g.remediation} — Est. $${g.estimated_cost_low_usd.toLocaleString()}–$${g.estimated_cost_high_usd.toLocaleString()}`
    );
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function runTierCertification(
  params: TierCertificationParams
): Promise<TierCertificationResult> {
  const {
    generator_config, ups_topology, cooling_redundancy,
    power_paths, fuel_runtime_hours, transfer_switch_type,
    has_concurrent_maintainability, has_fault_tolerance, target_tier,
  } = params;

  const t0 = Date.now();

  if (!TIER_REQUIREMENTS[target_tier]) {
    throw new Error(`Invalid target_tier '${target_tier}'. Must be one of: ${Object.keys(TIER_REQUIREMENTS).join(", ")}`);
  }

  const hasNPlus1 = detectNPlus1(generator_config) || detectNPlus1(ups_topology);
  const has2N     = detect2N(generator_config) && detect2N(ups_topology);
  const hasSts    = transfer_switch_type.toUpperCase().includes("STS");
  const effectiveFaultTolerance = has_fault_tolerance || (has2N && !has_fault_tolerance);

  const currentTier = achievedTier(
    power_paths, hasNPlus1, has_concurrent_maintainability,
    effectiveFaultTolerance, fuel_runtime_hours, hasSts,
  );

  const gap = buildGapAnalysis(currentTier, target_tier, {
    power_paths,
    has_n_plus_1:       hasNPlus1,
    has_concurrent:     has_concurrent_maintainability,
    has_fault_tolerance: effectiveFaultTolerance,
    fuel_hours:         fuel_runtime_hours,
    has_sts:            hasSts,
    cooling_redundancy,
  });

  const score = readinessScore(currentTier, target_tier, gap.gap_count);
  const steps = prioritySteps(gap.gaps);

  const currentReq = TIER_REQUIREMENTS[currentTier];
  const targetReq  = TIER_REQUIREMENTS[target_tier];

  const agentOutput: AgentOutput = {
    current_tier:          currentTier,
    target_tier,
    qualifies_for_target:  gap.already_qualifies,
    readiness_score_pct:   score,
    current_tier_details: {
      description:     currentReq.description,
      uptime_pct:      currentReq.uptime_pct,
      downtime_hrs_yr: currentReq.downtime_hrs_yr,
    },
    target_tier_details: {
      description:     targetReq.description,
      uptime_pct:      targetReq.uptime_pct,
      downtime_hrs_yr: targetReq.downtime_hrs_yr,
    },
    assessed_capabilities: {
      generator_config,
      ups_topology,
      cooling_redundancy,
      power_paths,
      fuel_runtime_hours,
      transfer_switch_type,
      has_n_plus_1:                    hasNPlus1,
      has_concurrent_maintainability,
      has_fault_tolerance:             effectiveFaultTolerance,
      has_sts:                         hasSts,
    },
    gap_analysis:               gap,
    priority_remediation_steps: steps,
    total_remediation_cost_low_usd:  gap.total_remediation_cost_low_usd,
    total_remediation_cost_high_usd: gap.total_remediation_cost_high_usd,
    disclaimer:
      "This is a readiness assessment, not official Uptime Institute certification. " +
      "Official certification requires on-site audit by Uptime Institute-accredited engineers. " +
      "See uptimeinstitute.com for official certification process.",
  };

  return {
    workflow:  "tier_certification_checker",
    target:    `${target_tier} readiness — ${generator_config}`,
    timestamp: new Date().toISOString(),
    results: { ...agentOutput, duration_ms: Date.now() - t0 },
  };
}
