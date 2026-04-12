const URBAN_DISTANCE_THRESHOLD_MILES = 1;
const RURAL_DISTANCE_THRESHOLD_MILES = 5;
const UNAVAILABLE_MODE_UNKNOWN = 'unknown';

export const DESIGNATION_STATUS = {
  DESIGNATED: 'designated',
  NOT_DESIGNATED: 'not_designated',
  UNKNOWN: 'unknown',
};

function toFiniteMiles(value) {
  if (value == null || value === '') return null;
  const miles = Number(value);
  return Number.isFinite(miles) ? miles : null;
}

export function evaluateFoodDesertDesignation({
  isRural,
  nearestSupermarketMiles,
  isTwentyFivePlusMiles,
  usdaLilaFlag,
  urbanThresholdMiles = URBAN_DISTANCE_THRESHOLD_MILES,
  ruralThresholdMiles = RURAL_DISTANCE_THRESHOLD_MILES,
  unavailableMode = UNAVAILABLE_MODE_UNKNOWN,
}) {
  const distanceThresholdMiles = isRural
    ? Number(ruralThresholdMiles) || RURAL_DISTANCE_THRESHOLD_MILES
    : Number(urbanThresholdMiles) || URBAN_DISTANCE_THRESHOLD_MILES;

  const normalizedNearestMiles = toFiniteMiles(nearestSupermarketMiles);
  const hasNearestDistance = normalizedNearestMiles != null;
  const hasTwentyFivePlusSignal = isTwentyFivePlusMiles === true;
  const hasUsdaFlag = usdaLilaFlag != null;
  const normalizedUsdaFlag = hasUsdaFlag ? Boolean(usdaLilaFlag) : null;

  const distanceRuleEvaluable = hasTwentyFivePlusSignal || hasNearestDistance;
  const isFoodDesertByDistanceRule =
    distanceRuleEvaluable
      ? hasTwentyFivePlusSignal ||
        (hasNearestDistance && normalizedNearestMiles >= distanceThresholdMiles)
      : null;

  const distanceDesignation = distanceRuleEvaluable
    ? (isFoodDesertByDistanceRule
      ? DESIGNATION_STATUS.DESIGNATED
      : DESIGNATION_STATUS.NOT_DESIGNATED)
    : DESIGNATION_STATUS.UNKNOWN;

  const usdaDesignation = hasUsdaFlag
    ? (normalizedUsdaFlag
      ? DESIGNATION_STATUS.DESIGNATED
      : DESIGNATION_STATUS.NOT_DESIGNATED)
    : DESIGNATION_STATUS.UNKNOWN;

  const canCompareSources =
    distanceDesignation !== DESIGNATION_STATUS.UNKNOWN &&
    usdaDesignation !== DESIGNATION_STATUS.UNKNOWN;

  const sourceDisagreement = canCompareSources && distanceDesignation !== usdaDesignation;

  let finalDesignation = distanceDesignation;
  let designationMethod = isRural
    ? 'distance_rule_rural_5mi'
    : 'distance_rule_urban_1mi';

  if (!distanceRuleEvaluable) {
    if (unavailableMode === 'usda_fallback' && hasUsdaFlag) {
      finalDesignation = usdaDesignation;
      designationMethod = normalizedUsdaFlag
        ? 'distance_rule_unavailable_usda_fallback'
        : 'distance_rule_unavailable';
    } else {
      finalDesignation = DESIGNATION_STATUS.UNKNOWN;
      designationMethod = 'distance_rule_unavailable_unknown';
    }
  }

  const isFoodDesert = finalDesignation === DESIGNATION_STATUS.UNKNOWN
    ? null
    : finalDesignation === DESIGNATION_STATUS.DESIGNATED;

  return {
    distanceThresholdMiles,
    distanceRuleEvaluable,
    isFoodDesertByDistanceRule,
    isFoodDesert,
    finalDesignation,
    distanceDesignation,
    usdaDesignation,
    sourceDisagreement,
    sourceAgreement: canCompareSources && !sourceDisagreement,
    sourceComparable: canCompareSources,
    designationMethod,
    nearestSupermarketMiles: normalizedNearestMiles,
  };
}
