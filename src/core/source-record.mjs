export const SOURCE_RECORD_SCHEMA_VERSION = '1.0';
export const SNAPSHOT_MANIFEST_SCHEMA_VERSION = '1.0';

function requiredString(value, name, errors) {
  if (typeof value !== 'string' || value.length === 0) errors.push(`${name} must be a non-empty string`);
}

export function validateSnapshotManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Snapshot manifest must be an object');
  }
  if (manifest.schema_version !== SNAPSHOT_MANIFEST_SCHEMA_VERSION) {
    errors.push(`unsupported snapshot manifest schema_version ${JSON.stringify(manifest.schema_version)}`);
  }
  requiredString(manifest.fingerprint, 'fingerprint', errors);
  requiredString(manifest.created_at, 'created_at', errors);
  if (!Number.isInteger(manifest.file_count) || manifest.file_count < 0) {
    errors.push('file_count must be a non-negative integer');
  }
  if (!Number.isInteger(manifest.total_bytes) || manifest.total_bytes < 0) {
    errors.push('total_bytes must be a non-negative integer');
  }
  if (!Array.isArray(manifest.files)) errors.push('files must be an array');
  if (!manifest.exclusions || typeof manifest.exclusions !== 'object') {
    errors.push('exclusions must be an object');
  }
  if (errors.length > 0) throw new Error(`Invalid snapshot manifest:\n- ${errors.join('\n- ')}`);
  return manifest;
}

export function validateSourceRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error('Source record must be an object');
  }
  if (record.schema_version !== SOURCE_RECORD_SCHEMA_VERSION) {
    errors.push(`unsupported source record schema_version ${JSON.stringify(record.schema_version)}`);
  }
  requiredString(record.id, 'id', errors);
  if (!['local', 'github'].includes(record.type)) errors.push('type must be local or github');
  requiredString(record.canonical_location, 'canonical_location', errors);
  requiredString(record.snapshot_fingerprint, 'snapshot_fingerprint', errors);
  requiredString(record.snapshot_path, 'snapshot_path', errors);
  requiredString(record.created_at, 'created_at', errors);
  if (record.type === 'github' && !/^[0-9a-f]{40}$/.test(record.revision || '')) {
    errors.push('GitHub source revision must be a full lowercase commit SHA');
  }
  if (!record.snapshot || typeof record.snapshot !== 'object') errors.push('snapshot is required');
  if (errors.length > 0) throw new Error(`Invalid source record:\n- ${errors.join('\n- ')}`);
  return record;
}
