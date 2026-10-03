export const BID_STAGES = [
  "identified",
  "pursuing",
  "takeoff",
  "pricing",
  "submitted",
  "won",
  "lost",
  "no_bid",
] as const;

export type BidStage = (typeof BID_STAGES)[number];

export const BID_STAGE_LABELS: Record<BidStage, string> = {
  identified: "Identified",
  pursuing: "Pursuing",
  takeoff: "Takeoff",
  pricing: "Pricing",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
  no_bid: "No Bid",
};

export function isBidStage(v: string): v is BidStage {
  return (BID_STAGES as readonly string[]).includes(v);
}
