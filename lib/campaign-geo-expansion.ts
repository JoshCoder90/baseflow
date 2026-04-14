/**
 * Degree offsets from campaign centroid for Nearby Search expansion (~0.05° lat ≈ 5.5km).
 * Used when valid lead count is still below target after searching the primary area.
 */
export const CAMPAIGN_NEARBY_OFFSET_DEG = [
  { lat: 0.05, lng: 0 },
  { lat: -0.05, lng: 0 },
  { lat: 0, lng: 0.05 },
  { lat: 0, lng: -0.05 },
  { lat: 0.05, lng: 0.05 },
  { lat: -0.05, lng: -0.05 },
] as const
