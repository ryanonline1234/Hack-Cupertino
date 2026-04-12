export type InterventionType = "grocery" | "garden" | "clinic" | "mobile";

export type Intervention = {
  id: string;
  type: InterventionType;
  x: number;
  z: number;
  placedAt: number;
};

export const INTERVENTION_META: Record<
  InterventionType,
  { label: string; emoji: string; accent: string }
> = {
  grocery: { label: "Grocery Store", emoji: "🏪", accent: "#00FF99" },
  garden: { label: "Community Garden", emoji: "🌱", accent: "#34D399" },
  clinic: { label: "Health Clinic", emoji: "🏥", accent: "#22D3EE" },
  mobile: { label: "Mobile Market", emoji: "🚚", accent: "#f472b6" },
};
