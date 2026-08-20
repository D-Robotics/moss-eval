import path from 'node:path';

export const SANDBOX_POLICY_VERSION = '1.0';

export class SandboxPolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SandboxPolicyError';
    this.code = code;
    this.details = details;
  }
}

function positive(value, fallback, name) {
  const effective = value ?? fallback;
  if (!Number.isFinite(effective) || effective <= 0) {
    throw new SandboxPolicyError('INVALID_RESOURCE_LIMIT', `${name} must be positive`);
  }
  return effective;
}

export function createSandboxPolicy(request = {}, authorization = null) {
  if (request.privileged === true) throw new SandboxPolicyError('PROHIBITED_PRIVILEGE', 'Privileged containers are prohibited');
  if (request.docker_socket === true) throw new SandboxPolicyError('PROHIBITED_DOCKER_SOCKET', 'Docker socket access is prohibited');
  if ((request.host_mounts || []).length > 0) throw new SandboxPolicyError('PROHIBITED_HOST_MOUNT', 'Repository-requested host mounts are prohibited');
  const network = request.network || 'disabled';
  if (!['disabled', 'public', 'allowlist'].includes(network)) {
    throw new SandboxPolicyError('INVALID_NETWORK_POLICY', `Unsupported network policy: ${network}`);
  }
  if (network !== 'disabled') {
    if (!authorization?.network?.approved) {
      throw new SandboxPolicyError('NETWORK_AUTHORIZATION_REQUIRED', `Explicit authorization is required for ${network} network access`);
    }
    if (authorization.network.mode !== network) {
      throw new SandboxPolicyError('NETWORK_AUTHORIZATION_MISMATCH', 'Authorized network mode does not match requested mode');
    }
  }
  if (network === 'allowlist' && !(request.allowed_hosts || []).length) {
    throw new SandboxPolicyError('NETWORK_ALLOWLIST_REQUIRED', 'Allowlist networking requires allowed_hosts');
  }
  return Object.freeze({
    schema_version: SANDBOX_POLICY_VERSION,
    privileged: false,
    docker_socket: false,
    host_pid: false,
    host_network: false,
    cap_drop: ['ALL'],
    no_new_privileges: true,
    read_only_root: request.read_only_root !== false,
    network,
    allowed_hosts: network === 'allowlist' ? [...request.allowed_hosts] : [],
    resources: {
      cpu: positive(request.cpu, 2, 'cpu'),
      memory_mb: positive(request.memory_mb, 2048, 'memory_mb'),
      pids: positive(request.pids, 256, 'pids'),
      disk_mb: positive(request.disk_mb, 4096, 'disk_mb'),
      timeout_seconds: positive(request.timeout_seconds, 600, 'timeout_seconds'),
    },
    writable_paths: [...new Set(request.writable_paths || ['/workspace', '/run', '/tmp'])],
    artifact_egress_paths: [...new Set(request.artifact_egress_paths || ['/run'])],
    authorization_id: authorization?.id || null,
  });
}

export function validateEvaluatorMounts(mounts) {
  for (const mount of mounts) {
    if (!['workspace', 'task', 'trial', 'evaluator'].includes(mount.role)) {
      throw new SandboxPolicyError('UNTRUSTED_MOUNT_ROLE', `Unsupported mount role: ${mount.role}`);
    }
    if (!path.isAbsolute(mount.source)) {
      throw new SandboxPolicyError('INVALID_MOUNT_SOURCE', `Mount source must be absolute: ${mount.source}`);
    }
    if (!mount.target?.startsWith('/')) {
      throw new SandboxPolicyError('INVALID_MOUNT_TARGET', `Mount target must be absolute: ${mount.target}`);
    }
    if (/docker\.sock|pipe[\\/]docker_engine/i.test(mount.source)) {
      throw new SandboxPolicyError('PROHIBITED_DOCKER_SOCKET', 'Docker control sockets cannot be mounted');
    }
    if (mount.role !== 'workspace' && mount.role !== 'trial' && mount.readOnly !== true) {
      throw new SandboxPolicyError('WRITEABLE_TRUSTED_MOUNT', `${mount.role} mount must be read-only`);
    }
  }
  return mounts;
}

export function dockerPolicyArgs(policy, ownerLabels = {}) {
  const args = [
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true',
    '--cpus', String(policy.resources.cpu),
    '--memory', `${policy.resources.memory_mb}m`,
    '--pids-limit', String(policy.resources.pids),
    '--storage-opt', `size=${policy.resources.disk_mb}m`,
  ];
  if (policy.read_only_root) args.push('--read-only', '--tmpfs', `/tmp:rw,noexec,nosuid,size=${Math.min(512, policy.resources.disk_mb)}m`);
  if (policy.network === 'disabled') args.push('--network', 'none');
  for (const [key, value] of Object.entries(ownerLabels)) args.push('--label', `${key}=${value}`);
  return args;
}
