import { randomUUID } from 'node:crypto';
import { hashObject } from '../lib/json.mjs';

export const AUTHORIZATION_SCHEMA_VERSION = '1.0';

export function createAuthorizationRequest(input) {
  const network = input.network || { mode: 'disabled', allowed_hosts: [] };
  return {
    schema_version: AUTHORIZATION_SCHEMA_VERSION,
    id: `auth-request-${randomUUID()}`,
    created_at: new Date().toISOString(),
    operation: input.operation,
    target_fingerprint: input.targetFingerprint || null,
    network: {
      mode: network.mode || 'disabled',
      allowed_hosts: [...new Set(network.allowed_hosts || [])],
      purpose: network.purpose || null,
    },
    secrets: [...new Set(input.secretNames || [])].map((name) => ({ name, purpose: input.secretPurposes?.[name] || null })),
  };
}

export function grantAuthorization(request, decision) {
  if (!decision?.confirmed) throw new Error('Authorization requires explicit user confirmation');
  const approvedSecrets = new Set(decision.approvedSecretNames || []);
  const requestedSecrets = new Set(request.secrets.map((secret) => secret.name));
  for (const name of approvedSecrets) {
    if (!requestedSecrets.has(name)) throw new Error(`Cannot approve an unrequested secret: ${name}`);
  }
  const networkApproved = request.network.mode === 'disabled' || decision.approveNetwork === true;
  return {
    schema_version: AUTHORIZATION_SCHEMA_VERSION,
    id: `authorization-${randomUUID()}`,
    request_id: request.id,
    granted_at: new Date().toISOString(),
    operation: request.operation,
    target_fingerprint: request.target_fingerprint,
    network: {
      approved: networkApproved,
      mode: networkApproved ? request.network.mode : 'disabled',
      allowed_hosts: networkApproved ? request.network.allowed_hosts : [],
    },
    secrets: request.secrets.map((secret) => ({
      name: secret.name,
      approved: approvedSecrets.has(secret.name),
    })),
    approval_fingerprint: hashObject({
      request_id: request.id,
      network: networkApproved,
      secrets: [...approvedSecrets].sort(),
    }),
  };
}

export function authorizedSecretValues(authorization, values = {}) {
  const approved = new Set(
    (authorization?.secrets || []).filter((secret) => secret.approved).map((secret) => secret.name),
  );
  return Object.fromEntries(
    Object.entries(values).filter(([name, value]) => approved.has(name) && typeof value === 'string'),
  );
}
