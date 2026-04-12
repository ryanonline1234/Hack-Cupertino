export const CORRELATIONS = {
  // USDA ERS 2009: food desert resolution reduces food insecurity
  foodInsecurityReduction: 0.15,

  // CDC + RWJF: food access improvement → relative diabetes reduction
  diabetesReductionRelative: 0.08,

  // USDA: grocery store halves effective distance burden for no-vehicle households
  vehicleBurdenReduction: 0.40,

  // McKinsey Global Institute food desert report 2020
  obesityReductionRelative: 0.05,

  // USDA ERS: average grocery store jobs created
  jobsCreatedMin: 8,
  jobsCreatedMax: 15,

  // Urban Institute: local economic multiplier for grocery retail
  economicMultiplier: 1.75,

  // Average annual US grocery store revenue (USDA)
  avgGroceryAnnualRevenue: 8_000_000,

  // Average yearly grocery spend per resident (rough national baseline)
  perCapitaGrocerySpend: 4_400,

  // Rule-of-thumb annual revenue supported per full-time grocery job
  revenuePerJob: 260_000,

  // Used when Census income is unavailable
  defaultHourlyWage: 18,

  // Approximate single-trip basket used by the "Impact Receipt"
  baseBasketCost: 45,

  // Typical household trip cadence for recurring grocery travel
  groceryTripsPerYear: 52,
};

export const SOURCES = [
  "USDA Economic Research Service, Food Access Research Atlas, 2019",
  "CDC PLACES Dataset, 2023",
  "McKinsey Global Institute, Food Desert Economic Impact, 2020",
  "Urban Institute, Grocery Store Economic Multiplier Study",
  "Robert Wood Johnson Foundation, Food Access and Health Outcomes, 2018",
];
