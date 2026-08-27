export const EVALUATION_POLICY_VERSION = 1

export const EVALUATION_POLICY = Object.freeze({
  shadow: Object.freeze({ minimumSamples: 100, minimumAdjudicatedSamples: 20 }),
  classifierRollout: Object.freeze({ minimumConfidence: 0.85, minimumMargin: 0.25, initialTrafficRatio: 0.1 }),
  rollback: Object.freeze({ negativeFeedbackIncreasePoints: 3, hardFailureIncreaseTriggersRollback: true }),
  hiddenQuotaProbe: Object.freeze({ maximumPerModelPerDay: 2, exactQuotaCooldownMs: 30 * 60 * 1000 }),
  imageAcceptance: Object.freeze(['artifact-generated', 'semantic-match', 'required-text-readable']),
})

export function classifierRolloutGate(classifier, sampleCounts = {}) {
  const reasons = []
  if ((sampleCounts.shadow ?? 0) < EVALUATION_POLICY.shadow.minimumSamples) reasons.push('insufficient-shadow-samples')
  if ((sampleCounts.adjudicated ?? 0) < EVALUATION_POLICY.shadow.minimumAdjudicatedSamples) reasons.push('insufficient-adjudicated-samples')
  if ((classifier?.confidence ?? 0) < EVALUATION_POLICY.classifierRollout.minimumConfidence) reasons.push('confidence-below-threshold')
  if ((classifier?.margin ?? 0) < EVALUATION_POLICY.classifierRollout.minimumMargin) reasons.push('margin-below-threshold')
  return { eligible: reasons.length === 0, reasons, policyVersion: EVALUATION_POLICY_VERSION }
}

export function executionPolicy(requestType, { allowToolAssisted = true } = {}) {
  const artifact = requestType === 'image-generation' ? 'image' : requestType === 'video-generation' ? 'video' : undefined
  return {
    preferredPath: 'native-model',
    allowToolAssisted: Boolean(artifact) && allowToolAssisted,
    requiredArtifact: artifact,
    imageAcceptance: artifact === 'image' ? EVALUATION_POLICY.imageAcceptance : undefined,
  }
}
