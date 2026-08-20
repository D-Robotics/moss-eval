export function calibrateJudgeLabels(records, thresholds = {}) {
  const decided = records.filter((record) => ['pass', 'fail'].includes(record.human) && ['pass', 'fail'].includes(record.judge));
  const agreements = decided.filter((record) => record.human === record.judge).length;
  const uncertain = records.filter((record) => record.judge === 'uncertain').length;
  const agreement = decided.length ? agreements / decided.length : null;
  const uncertainRate = records.length ? uncertain / records.length : null;
  const minimumRecords = thresholds.minimum_records ?? 30;
  const minimumAgreement = thresholds.minimum_agreement ?? 0.85;
  const maximumUncertainRate = thresholds.maximum_uncertain_rate ?? 0.15;
  return {
    schema_version: '1.0',
    record_count: records.length,
    decided_count: decided.length,
    agreement,
    uncertain_rate: uncertainRate,
    thresholds: { minimum_records: minimumRecords, minimum_agreement: minimumAgreement, maximum_uncertain_rate: maximumUncertainRate },
    gate: records.length >= minimumRecords && agreement !== null && agreement >= minimumAgreement && uncertainRate <= maximumUncertainRate ? 'pass' : 'fail',
  };
}
