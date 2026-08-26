import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectHarness } from './harness-inspection.mjs';
import { ingestGitHubSource, ingestLocalSource } from './source-ingestion.mjs';
import { loadConfig } from './config.mjs';
import { loadTasks, selectTasks } from './task-loader.mjs';
import { evaluate } from './evaluator.mjs';
import { aggregateRun } from './aggregate.mjs';
import { loadRunArtifacts, readRunMetadata } from './artifacts.mjs';
import { createBuiltInTargetRegistry } from '../targets/index.mjs';
import { createPreparedTargetManifest, loadPreparedTarget, savePreparedTarget } from '../targets/prepared-target.mjs';
import { redactObject, writeJson } from '../lib/json.mjs';
import { authorizedSecretValues, createAuthorizationRequest, grantAuthorization } from './authorization.mjs';
import { buildPreparedImage } from './preparation-runner.mjs';
import { createRunner } from '../runners/index.mjs';
import { mossConfigFile, publicModelConfiguration, validateModelConfiguration } from './model-configuration.mjs';

function identifier(value, label = 'identifier') {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(String(value || ''))) throw new Error(`Invalid ${label}`);
  return String(value);
}

export class EvaluationService {
  constructor(options) {
    this.paths = options.paths;
    this.registry = options.registry || createBuiltInTargetRegistry();
    this.evaluateFn = options.evaluateFn || evaluate;
    this.controllers = new Map();
    this.preparationControllers = new Map();
    this.eventSink = options.eventSink || (() => {});
    this.dockerCommand = options.dockerCommand || 'docker';
    this.runnerFactory = options.runnerFactory || createRunner;
  }

  emit(type, data) { this.eventSink({ schema_version: '1.0', timestamp: new Date().toISOString(), type, data: redactObject(data, []) }); }

  configureRuntime(runtime = {}) {
    const command = String(runtime.docker_command || '');
    const isDockerPath = (path.isAbsolute(command) || path.win32.isAbsolute(command)) && path.win32.basename(command).toLowerCase() === 'docker.exe';
    if ((command !== 'docker' && !isDockerPath) || /[\r\n\0]/.test(command)) throw new Error('Invalid Docker runtime command');
    this.dockerCommand = command;
    return { docker_command_configured: true };
  }

  addGithubSource(request) { return ingestGitHubSource(request.url, { ...request, sourcesRoot: this.paths.sources }); }
  addLocalSource(request) { return ingestLocalSource(request.directory, { ...request, sourcesRoot: this.paths.sources }); }
  inspect(sourceRecord) { return inspectHarness(sourceRecord); }

  async prepare(request) {
    if (request.confirmed !== true) throw new Error('Preparation requires explicit review confirmation');
    const preparationId=identifier(request.preparation_id||`prepare-${Date.now()}`,'preparation identifier');
    const controller=new AbortController();
    this.preparationControllers.set(preparationId,controller);
    try {
    const adapter = this.registry.get(identifier(request.adapter_id, 'adapter identifier'));
    const declaredSecrets=adapter.id==='moss'?['ANTHROPIC_API_KEY','OPENAI_API_KEY']:(request.configuration?.environment?.secrets||[]);
    const requestedBuildSecrets=request.build_secret_names||[];
    if(requestedBuildSecrets.some((name)=>!declaredSecrets.includes(name)))throw new Error('Build requested an undeclared secret');
    const preparationPlan = adapter.createPreparationPlan({ sourceRecord: request.source_record, configuration:request.configuration||{}, manifest:request.configuration||{}, ...(request.configuration || {}) });
    preparationPlan.secret_names=[...requestedBuildSecrets];
    const needsNetwork=preparationPlan.steps.some((step)=>step.network===true);
    const buildNetworkRequested=needsNetwork||request.approve_network===true;
    const authorizationRequest=createAuthorizationRequest({operation:'prepare-target',network:{mode:buildNetworkRequested?'public':'disabled',purpose:needsNetwork?'install declared build dependencies':'pull the selected base image if it is not cached'},secretNames:requestedBuildSecrets});
    const authorization=grantAuthorization(authorizationRequest,{confirmed:true,approveNetwork:request.approve_network===true,approvedSecretNames:request.approved_build_secret_names||[]});
    let build=null;
    let imageDigest=request.image_digest||null;
    if(imageDigest&&request.allow_prebuilt!==true)throw new Error('Prebuilt image digests require an explicit trusted override');
    const buildSecretValues=authorizedSecretValues(authorization,process.env);
    if(!imageDigest){
      build=await buildPreparedImage({sourceRecord:request.source_record,plan:preparationPlan,baseImage:request.base_image||'node:22-bookworm',sandboxPolicy:request.sandbox_policy,authorization,secretValues:buildSecretValues,signal:controller.signal}, {dockerCommand:this.dockerCommand,onEvent:(event)=>this.emit(event.type,{...event.data,preparation_id:preparationId})});
      imageDigest=build.image_digest;
    }
    const capabilities=adapter.describeCapabilities({manifest:request.configuration||null,configuration:request.configuration||null});
    const launch=adapter.id==='manifest-command'
      ? {command:path.posix.join('/target',request.configuration.launch.command),args:request.configuration.launch.args||[],protocol:request.configuration.launch.protocol,working_directory:request.configuration.launch.working_directory||'/workspace'}
      : {command:'moss',args:['{instruction}'],protocols:capabilities.modes};
    const target = createPreparedTargetManifest({
      sourceRecord: request.source_record,
      adapter,
      effectiveConfiguration: request.configuration || {},
      preparationPlan,
      launch,
      sandboxPolicy: { preparation: build?.policy || request.sandbox_policy, trial: { ...(request.sandbox_policy || {}), network:'disabled' } },
      runtime: { ...(request.runtime || {}), base_image:request.base_image || null, base_image_digest:build?.base_image_digest || null },
      imageDigest,
      configuredImage: request.base_image || request.configured_image || null,
      capabilities,
      requiredSecrets:declaredSecrets,
      runtimeNetworkRequired:Boolean(request.configuration?.network?.runtime_required),
    });
    const saved = await savePreparedTarget(target, this.paths.targets);
    this.emit('target_prepared', { target_fingerprint: target.target_fingerprint, reused: saved.reused });
    if(build)await writeJson(path.join(path.dirname(saved.file),'preparation.json'),redactObject({...build,authorization:{...authorization,secrets:authorization.secrets.map((item)=>({name:item.name,approved:item.approved}))}},Object.values(buildSecretValues)));
    return {...saved,preparation_id:preparationId,build:build?{image_digest:build.image_digest,started_at:build.started_at,completed_at:build.completed_at,policy:build.policy}:null};
    } finally { this.preparationControllers.delete(preparationId); }
  }

  async testModelConnection(request) {
    const targetId = identifier(request.target_fingerprint, 'target fingerprint');
    const preparedTarget = await loadPreparedTarget(path.join(this.paths.targets, targetId, 'prepared-target.json'));
    if (preparedTarget.target_fingerprint !== targetId) throw new Error('Prepared target identity mismatch');
    if (preparedTarget.adapter.id !== 'moss') throw Object.assign(new Error('Model connection testing is supported only for the MOSS adapter'), { code: 'MODEL_TEST_UNSUPPORTED' });
    const configuration = validateModelConfiguration(request.model_configuration);
    const authorizationRequest = createAuthorizationRequest({
      operation: 'test-model-connection',
      targetFingerprint: targetId,
      network: { mode: 'public', purpose: 'Test the configured model provider' },
      secretNames: ['MOSS_MODEL_API_KEY'],
    });
    const authorization = grantAuthorization(authorizationRequest, {
      confirmed: true,
      approveNetwork: request.approve_runtime_network === true,
      approvedSecretNames: ['MOSS_MODEL_API_KEY'],
    });
    if (!authorization.network.approved) throw Object.assign(new Error('Model connection testing requires explicit runtime network authorization'), { code: 'RUNTIME_NETWORK_NOT_AUTHORIZED' });

    const operationRoot = path.resolve(this.paths.cache, 'model-connections', `test-${randomUUID()}`);
    const cacheRoot = path.resolve(this.paths.cache);
    if (!operationRoot.startsWith(cacheRoot + path.sep)) throw new Error('Model connection test path escaped cache storage');
    const workspace = path.join(operationRoot, 'workspace');
    const trialDir = path.join(operationRoot, 'trial');
    await Promise.all([fsp.mkdir(workspace, { recursive: true }), fsp.mkdir(trialDir, { recursive: true })]);
    try {
      const runner = this.runnerFactory('docker', { docker: { command: this.dockerCommand } });
      const task = {
        id: 'model-connection',
        environment: {
          image: preparedTarget.image_digest,
          network: 'public',
          authorization,
          cpu: 1,
          memory_mb: 512,
          pids: 32,
          disk_mb: 256,
          read_only_root: true,
        },
      };
      const result = await runner.run({
        command: 'node',
        args: ['/eval/drivers/model-connection-probe.mjs', '/run/.secrets/moss-model.json'],
        input: null,
        env: {},
        metadata: { adapter: 'moss', operation: 'model-connection-test', secret_env_names: [] },
        secret_files: [{ path: '.secrets/moss-model.json', content: mossConfigFile(configuration) }],
      }, {
        task,
        replicate: 1,
        workspace,
        taskDir: path.join(this.paths.projectRoot, 'taskpacks', 'core'),
        trialDir,
        runDir: operationRoot,
        evalRoot: this.paths.projectRoot,
        timeoutMs: 30_000,
      });
      let diagnostic;
      try { diagnostic = JSON.parse(String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1)); }
      catch { diagnostic = { schema_version: '1.0', ok: false, status: null, latency_ms: result.durationMs, error_code: 'INVALID_CONNECTION_TEST_RESPONSE' }; }
      return {
        schema_version: '1.0',
        configuration: publicModelConfiguration(configuration),
        ok: result.exitCode === 0 && diagnostic.ok === true,
        status: Number.isInteger(diagnostic.status) ? diagnostic.status : null,
        latency_ms: Number.isFinite(diagnostic.latency_ms) ? diagnostic.latency_ms : result.durationMs,
        error_code: diagnostic.error_code || (result.timedOut ? 'CONNECTION_TEST_TIMEOUT' : result.exitCode === 0 ? null : 'MODEL_CONNECTION_FAILED'),
      };
    } finally {
      await fsp.rm(operationRoot, { recursive: true, force: true });
    }
  }

  cancelPreparation(preparationId) {
    const safe=identifier(preparationId,'preparation identifier');
    const controller=this.preparationControllers.get(safe);
    if(!controller)return {cancelled:false,reason:'preparation is not active or owned by this worker'};
    controller.abort();
    this.emit('preparation_cancellation_requested',{preparation_id:safe});
    return {cancelled:true,preparation_id:safe};
  }

  async start(request) {
    const configName = identifier(request.config_id, 'config identifier');
    const configFile = path.join(this.paths.projectRoot, 'configs', configName);
    if (path.dirname(configFile) !== path.join(this.paths.projectRoot, 'configs')) throw new Error('Config path escaped resources');
    const config = await loadConfig(configFile);
    config.output_root = this.paths.runs;
    config.runners.docker.command = this.dockerCommand;
    let preparedTarget = null;
    let modelConfiguration = null;
    if (request.target_fingerprint) {
      const targetId = identifier(request.target_fingerprint, 'target fingerprint');
      preparedTarget = await loadPreparedTarget(path.join(this.paths.targets, targetId, 'prepared-target.json'));
      if (preparedTarget.target_fingerprint !== targetId) throw new Error('Prepared target identity mismatch');
      if (preparedTarget.adapter.id === 'moss' && request.approve_agent_workspace_actions !== true) {
        throw Object.assign(
          new Error('MOSS evaluation requires explicit authorization to modify the isolated workspace and run tests'),
          { code: 'AGENT_ACTIONS_NOT_AUTHORIZED' },
        );
      }
      config.execution.environment_overrides = {
        ...(config.execution.environment_overrides || {}),
        runner: 'docker',
        image: preparedTarget.image_digest,
      };
      if (request.model_configuration) {
        if (preparedTarget.adapter.id !== 'moss') throw Object.assign(new Error('Model configuration is supported only for the MOSS adapter'), { code: 'MODEL_CONFIGURATION_UNSUPPORTED' });
        modelConfiguration = validateModelConfiguration(request.model_configuration);
      }
      if(preparedTarget.runtime_network_required || modelConfiguration){
        const runtimeAuthorizationRequest=createAuthorizationRequest({operation:'evaluate-target',targetFingerprint:preparedTarget.target_fingerprint,network:{mode:'public',purpose:'Harness runtime declared outbound access'}});
        const runtimeAuthorization=grantAuthorization(runtimeAuthorizationRequest,{confirmed:true,approveNetwork:request.approve_runtime_network===true});
        if(!runtimeAuthorization.network.approved)throw Object.assign(new Error('Target runtime network requires explicit approval'), { code: 'RUNTIME_NETWORK_NOT_AUTHORIZED' });
        config.execution.environment_overrides.network='public';
        config.execution.environment_overrides.authorization=runtimeAuthorization;
      }
      for (const agent of Object.values(config.agents)) {
        agent.track = 'prepared-target';
        agent.source_repository = preparedTarget.source.canonical_location;
        agent.source_commit = preparedTarget.source.revision || null;
        agent.source_snapshot_fingerprint = preparedTarget.source.fingerprint;
        agent.prepared_target_fingerprint = preparedTarget.target_fingerprint;
        agent.prepared_target_adapter = preparedTarget.adapter;
        agent.prepared_target_policy = preparedTarget.sandbox_policy;
        if (preparedTarget.adapter.id === 'moss') {
          Object.defineProperty(agent, '_moss_auto_approve', { value: true, enumerable: false, configurable: false });
          agent.isolated_workspace_actions_authorized = true;
        }
        if (modelConfiguration) {
          Object.defineProperty(agent, '_model_configuration', { value: modelConfiguration, enumerable: false, configurable: false });
          agent.provider = modelConfiguration.provider;
          agent.model = modelConfiguration.model;
        }
        const approvedSecrets=new Set(request.approved_secret_names||[]);
        for(const name of approvedSecrets)if(!(preparedTarget.required_secrets||[]).includes(name))throw new Error(`Cannot approve undeclared runtime secret: ${name}`);
        agent.secret_env=(preparedTarget.required_secrets||[]).filter((name)=>approvedSecrets.has(name));
        if(preparedTarget.adapter.id==='manifest-command'){
          agent.adapter='command';
          agent.command=preparedTarget.launch.command;
          agent.args=[...(preparedTarget.launch.args||[])];
          if(!agent.args.includes('{instruction}'))agent.args.push('{instruction}');
          delete agent.mode_commands;
          delete agent.mode_base_args;
          delete agent.mode_args;
        }
      }
    }
    const allTasks = await loadTasks(config.task_roots);
    const tasks = selectTasks(allTasks, { suite: request.suite || 'release', ids: request.task_ids || null });
    if (!tasks.length) throw new Error('No eligible tasks selected');
    const controller = new AbortController();
    let knownRunId = null;
    let resolveStarted;
    let rejectStarted;
    const started = new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
    this.evaluateFn({
      tasks,
      agentNames: request.agent_names || Object.keys(config.agents),
      config,
      label: request.label || request.suite || 'desktop',
      trialsOverride: request.trials || null,
      concurrency: request.concurrency || config.execution.concurrency,
      runnerOverride: request.runner || null,
      allowLocal: false,
      signal: controller.signal,
      onRunStart: (run) => { knownRunId = run.run_id; this.controllers.set(knownRunId, controller); this.emit('run_started', run); resolveStarted({ run_id: knownRunId, run_directory: run.run_directory }); },
      onTrialStart: (unit) => this.emit('trial_started', { run_id: knownRunId, task_id: unit.task.id, agent: unit.agentName, replicate: unit.replicate }),
      progress: (trial, completed, total) => this.emit('trial_completed', { run_id: knownRunId, trial, completed, total }),
      targetCapabilitiesByAgent: preparedTarget
        ? Object.fromEntries((request.agent_names || Object.keys(config.agents)).map((name) => [name, { schema_version:'1.0', modes:preparedTarget.capabilities.modes || [], telemetry_level:preparedTarget.capabilities.telemetry_level || 'L0', tools:preparedTarget.capabilities.tools || [], tags:preparedTarget.capabilities.tags || [], runners:['docker'], sandbox_features:['isolated-workspace','network-policy'] }]))
        : request.target_capabilities || {},
    }).then(async (run) => {
      const summary = await aggregateRun(run.runDir, { k: request.k || config.execution.k });
      this.emit('run_completed', { run_id: run.runId, summary });
      return { run_id: run.runId, run_directory: run.runDir, summary };
    }).catch((error) => { if (!knownRunId) rejectStarted(error); this.emit('run_failed', { run_id: knownRunId, error: error.message, code: error.code || null }); })
      .finally(() => { if (knownRunId) this.controllers.delete(knownRunId); });
    return started;
  }

  cancel(runId) {
    const safe = identifier(runId, 'run identifier');
    const controller = this.controllers.get(safe);
    if (!controller) return { cancelled: false, reason: 'run is not owned by this worker or is no longer active' };
    controller.abort();
    this.emit('run_cancellation_requested', { run_id: safe });
    return { cancelled: true, run_id: safe };
  }

  async listRuns() {
    let entries = [];
    try { entries = await fsp.readdir(this.paths.runs, { withFileTypes: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const runs = [];
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const directory = path.join(this.paths.runs, entry.name);
      try {
        const metadata = await readRunMetadata(directory, { optional: true });
        runs.push({ id: metadata?.run_id || entry.name, status: metadata?.status || 'interrupted', metadata });
      } catch (error) { runs.push({ id: entry.name, status: 'corrupt', error: error.message, code: error.code || null }); }
    }
    return runs.sort((a, b) => b.id.localeCompare(a.id));
  }

  async listTasks() {
    const tasks = await loadTasks([path.join(this.paths.projectRoot, 'taskpacks')]);
    return tasks.map((task) => ({ id: task.id, version: String(task.version), title: task.title, category: task.category, priority: task.priority, mode: task.mode, suites: task.suites, quality_tier: task.quality_tier, capability_requirements: task.capability_requirements }));
  }

  queryRun(runId) { return loadRunArtifacts(path.join(this.paths.runs, identifier(runId, 'run identifier'))); }

  async exportRun(runId, destination, format = 'json') {
    const run = await this.queryRun(runId);
    const safe = redactObject(run, []);
    if (format === 'markdown') {
      const trials = safe.trials || [];
      const lines = ['# MOSS Eval report', '', `Run: ${safe.metadata?.run_id || runId}`, '', '| Task | Agent | Trial | Status | Duration |', '|---|---|---:|---|---:|', ...trials.map((trial) => `| ${trial.task.id} | ${trial.agent} | ${trial.replicate} | ${trial.status} | ${trial.metrics?.duration_ms ?? 'N/A'} |`), '', 'All fields are exported from redacted canonical artifacts.', ''];
      await fsp.writeFile(destination, lines.join('\n'), 'utf8');
    } else await writeJson(destination, safe);
    return { destination, format };
  }
}
