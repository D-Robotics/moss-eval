import { PRIMARY_STEPS, SECONDARY_DESTINATIONS, diagnoseRun, explainMetric, friendlyError, friendlyFailure, groupTrialsByTask, guardStep, inferApiProtocol, releasePresentation, validateModelInputs, validateSourceSelection, workflowReadiness } from './workflow.mjs';

const api = window.mossEval;
const tabs = [...PRIMARY_STEPS, ...SECONDARY_DESTINATIONS];
const PENDING_PREPARATION_KEY = 'moss-eval.pending-preparation.v1';
const state = { sourceRecord:null, inspection:null, prepared:null, preparationId:null, activeRun:null, runs:[], events:[], selectedRun:null, doctor:null, doctorRefreshing:false, doctorTimer:null, doctorPollCount:0, pendingPreparation:null, resumeInProgress:false, configureDraft:null, sourceMode:'github', sourceDraft:{url:'',ref:'main',local:''}, currentView:'source' };

const node = (tag, attrs = {}, children = []) => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'checked') element.checked = value;
    else if (key === 'readonly') element.readOnly = Boolean(value);
    else if (key === 'disabled') element.disabled = Boolean(value);
    else if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
  element.append(...(Array.isArray(children) ? children : [children]));
  return element;
};
const text = (value) => document.createTextNode(String(value ?? ''));
const byId = (id) => document.getElementById(id);
const clear = (element, ...children) => element.replaceChildren(...children);
const field = (title, control, className = '') => {
  const errorId=control.id?`${control.id}-error`:null;
  if(errorId)control.setAttribute('aria-describedby',errorId);
  return node('label', { class:className }, [text(title), control,...(errorId?[node('span',{id:errorId,class:'field-error',role:'alert'})]:[])]);
};
const button = (label, action, className = '') => node('button', { type:'button', class:className, text:label, onclick:action });
const json = (value) => node('pre', { text: JSON.stringify(value, null, 2) });
const toast = (message) => { const target=byId('toast'); target.textContent=message; target.classList.add('show'); setTimeout(()=>target.classList.remove('show'),2600); };
const safely = (work) => async (...args) => { try { return await work(...args); } catch (error) { toast(`${error.code || 'ERROR'}: ${error.message}`); } };

function showFieldError(controlId,message){
  const control=byId(controlId);const target=byId(`${controlId}-error`);
  if(target)target.textContent=message;
  if(control){
    const details=control.closest('details');if(details)details.open=true;
    if(controlId==='prepare-target'){const environmentDetails=byId('environment-details');if(environmentDetails)environmentDetails.open=true;}
    control.setAttribute('aria-invalid','true');control.focus();control.scrollIntoView?.({block:'center',behavior:'smooth'});
  }
}
function clearFieldError(controlId){const control=byId(controlId);const target=byId(`${controlId}-error`);if(target)target.textContent='';if(control)control.removeAttribute('aria-invalid');}
function setActionStatus(target,kind,message){if(!target)return;target.className=`action-status ${kind||''}`.trim();target.textContent=message||'';target.setAttribute('role','status');target.setAttribute('aria-live','polite');}
async function runAction({control,busyLabel,status,busyText,successText,work}){
  if(control.dataset.busy==='true')return null;
  const original=control.textContent;control.dataset.busy='true';control.disabled=true;control.setAttribute('aria-busy','true');control.textContent=busyLabel;
  setActionStatus(status,'busy',busyText||busyLabel);
  try{
    const result=await work((message)=>setActionStatus(status,'busy',message));
    setActionStatus(status,'success',typeof successText==='function'?successText(result):successText);
    return result;
  }catch(error){
    const message=friendlyError(error);setActionStatus(status,'failure',message);toast(message);return null;
  }finally{
    control.dataset.busy='false';control.disabled=false;control.removeAttribute('aria-busy');control.textContent=original;
  }
}

function loadPendingPreparation(){
  try {
    const value=JSON.parse(localStorage.getItem(PENDING_PREPARATION_KEY)||'null');
    return value?.schema_version==='1.0'&&value.request?.source_record&&value.request?.adapter_id?value:null;
  } catch { return null; }
}
function savePendingPreparation(value){state.pendingPreparation=value;localStorage.setItem(PENDING_PREPARATION_KEY,JSON.stringify(value));renderPrerequisites();}
function clearPendingPreparation(){state.pendingPreparation=null;localStorage.removeItem(PENDING_PREPARATION_KEY);renderPrerequisites();}
function stopDoctorPolling(){if(state.doctorTimer){clearInterval(state.doctorTimer);state.doctorTimer=null;}state.doctorPollCount=0;}
function startDoctorPolling(){
  if(state.doctorTimer)return;
  state.doctorPollCount=0;
  state.doctorTimer=setInterval(()=>{state.doctorPollCount+=1;if(state.doctorPollCount>120)stopDoctorPolling();else refreshDoctor();},5000);
}

function updateDoctorBadge(){
  const target=byId('doctor');if(!target)return;
  if(!state.doctor){target.textContent='环境检查中';target.className='pill';target.title='';return;}
  target.textContent=state.doctor.ready?'环境就绪':'环境需处理';
  target.className=`pill ${state.doctor.ready?'ok':'warn'}`;
  target.title=(state.doctor.checks||[]).map(c=>`[${c.status}] ${c.id}: ${c.detail}${c.remediation?`\n处理建议: ${c.remediation}`:''}`).join('\n\n');
}

function renderPrerequisites(){
  const target=byId('prerequisite-panel');if(!target)return;
  if(!state.doctor){
    clear(target,
      node('div',{class:'runtime-summary'},[
        node('span',{class:'runtime-indicator checking','aria-hidden':'true'}),
        node('div',{class:'runtime-summary-copy'},[node('span',{class:'section-kicker',text:'本机环境'}),node('h2',{text:'正在检查运行条件'}),node('p',{class:'muted',text:'你可以先填写左侧配置，检查会在后台完成。'})]),
        node('span',{class:'status',text:'检查中'}),
      ]),
    );
    return;
  }
  const checks=state.doctor.checks||[];
  const failedChecks=checks.filter(check=>check.status!=='pass');
  const environmentStatus=node('div',{id:'environment-action-status',class:'action-status',role:'status','aria-live':'polite',text:state.doctor.ready?'无需处理，可以准备评测环境。':'先处理下面的问题，客户端会自动重新检测。'});
  const rows=checks.map(check=>node('div',{class:`prerequisite ${check.status==='pass'?'pass':'fail'}`},[
    node('div',{class:'prerequisite-copy'},[node('strong',{text:`${check.status==='pass'?'✓':'!'} ${check.id}`}),node('div',{class:'muted',text:check.detail}),...(check.remediation?[node('div',{class:'hint',text:check.remediation})]:[])]),
    ...(check.status!=='pass'&&check.action?[(()=>{let control;control=button(check.action_label||'处理',async()=>{await runAction({control,busyLabel:'正在处理…',status:environmentStatus,busyText:'正在打开处理步骤…',successText:'处理步骤已启动，完成后客户端会自动重新检测。',work:()=>runPrerequisiteAction(check.action)});},'primary');return control;})()]:[]),
  ]));
  const pending=state.pendingPreparation?node('div',{class:'resume-note'},[
    node('strong',{text:'已保存评测环境设置'}),
    node('span',{text:' 运行环境就绪后会自动继续一次；项目和非敏感配置无需重新填写。'}),
    button('取消自动继续',()=>{clearPendingPreparation();stopDoctorPolling();}),
  ]):null;
  let refreshButton;refreshButton=button('重新检测',async()=>{await runAction({control:refreshButton,busyLabel:'正在检测…',status:environmentStatus,busyText:'正在检查 Windows、WSL2、虚拟化和 Docker…',successText:(doctor)=>doctor?.ready?'运行环境已经就绪。':'仍有项目需要处理，请查看上方提示。',work:refreshDoctor});});
  const primaryFailure=failedChecks[0];
  let primaryAction=null;
  if(primaryFailure?.action){
    primaryAction=button(primaryFailure.action_label||'立即处理',async()=>{await runAction({control:primaryAction,busyLabel:'正在处理…',status:environmentStatus,busyText:'正在打开处理步骤…',successText:'处理步骤已启动，完成后会自动重新检测。',work:()=>runPrerequisiteAction(primaryFailure.action)});},'primary compact');
  }
  const details=node('details',{id:'environment-details',class:'runtime-details'},[
    node('summary',{text:`查看环境详情${checks.length?`（${checks.filter(check=>check.status==='pass').length}/${checks.length} 项通过）`:''}`}),
    node('div',{class:'runtime-checks'},rows),
    node('div',{class:'runtime-detail-footer'},[refreshButton,node('span',{class:'muted',text:'仅准备环境和正式评测需要 Docker。'})]),
  ]);
  if(!state.doctor.ready)details.open=true;
  clear(target,
    node('div',{class:'runtime-summary'},[
      node('span',{class:`runtime-indicator ${state.doctor.ready?'ready':'blocked'}`,'aria-hidden':'true'}),
      node('div',{class:'runtime-summary-copy'},[
        node('span',{class:'section-kicker',text:'本机环境'}),
        node('h2',{text:state.doctor.ready?'运行环境已就绪':'运行环境需要处理'}),
        node('p',{class:'muted',text:state.doctor.ready?'Docker 与隔离运行条件正常。':`${failedChecks.length} 项条件尚未满足，处理后可继续。`}),
      ]),
      node('span',{class:`status ${state.doctor.ready?'ok':'warn'}`,text:state.doctor.ready?'已就绪':'需处理'}),
    ]),
    ...(primaryAction?[node('div',{class:'runtime-primary-action'},[primaryAction])]:[]),
    ...(pending?[pending]:[]),
    details,
    environmentStatus,
  );
}

async function runPrerequisiteAction(action){
  const result=await api.remediatePrerequisite(action);
  toast(result.started?'Docker Desktop 已启动，正在等待 daemon':'已打开官方安装说明，完成后返回本客户端');
  startDoctorPolling();
  setTimeout(()=>refreshDoctor(),1500);
}

async function executePreparation(request,{automatic=false}={}){
  if(automatic)clearPendingPreparation();
  state.preparationId=request.preparation_id;
  try{
    state.prepared=await api.prepare(request);
    updateNavigationState();renderLive();
    toast(automatic?'运行环境已就绪，评测环境已自动准备完成':(state.prepared.reused?'已复用准备好的评测环境':'评测环境准备完成'));
    return state.prepared;
  }finally{state.preparationId=null;}
}

async function resumePendingPreparation(){
  if(!state.pendingPreparation||state.resumeInProgress||!state.doctor?.ready)return;
  const pending=state.pendingPreparation;
  state.resumeInProgress=true;
  state.sourceRecord=pending.source_record;
  state.inspection=pending.inspection;
  state.configureDraft=pending.draft||null;
  if(byId('inspection-content'))renderInspection();
  renderConfigure();show('configure');
  try{await executePreparation(pending.request,{automatic:true});}
  catch(error){toast(`${error.code||'PREPARATION_FAILED'}: ${error.message}`);}
  finally{state.resumeInProgress=false;}
}

async function refreshDoctor(){
  if(state.doctorRefreshing)return state.doctor;
  state.doctorRefreshing=true;
  try{
    state.doctor=await api.doctor();
    updateDoctorBadge();renderPrerequisites();
    if(state.doctor.ready){stopDoctorPolling();await resumePendingPreparation();}
    else if(state.pendingPreparation)startDoctorPolling();
    return state.doctor;
  }finally{state.doctorRefreshing=false;}
}

function updateNavigationState(){
  const readiness=workflowReadiness(state);
  for(const step of PRIMARY_STEPS){
    const control=document.querySelector(`[data-tab="${step.id}"]`);if(!control)continue;
    const ready=readiness[step.id];control.classList.toggle('locked',!ready);control.setAttribute('aria-disabled',String(!ready));
    const badge=control.querySelector('.step-state');if(badge)badge.textContent=state.currentView===step.id?'当前':ready?'可进入':'待完成';
  }
}

function showDirect(name){
  const changed=state.currentView!==name;
  state.currentView=name;
  for(const item of tabs){const view=byId(item.id);if(view)view.hidden=item.id!==name;const control=document.querySelector(`[data-tab="${item.id}"]`);if(control){control.classList.toggle('active',item.id===name);control.setAttribute('aria-current',item.id===name?'step':'false');}}
  updateNavigationState();
  if(changed)window.scrollTo(0,0);
  if(name==='history')loadHistory();if(name==='report')renderReport();
}

function show(name,{force=false}={}){
  if(!force&&PRIMARY_STEPS.some(step=>step.id===name)){
    const decision=guardStep(name,{...state,sourceMode:state.sourceMode});
    if(!decision.allowed){
      showDirect(decision.redirect);const feedback=byId('workflow-feedback');setActionStatus(feedback,'failure',decision.message);
      setTimeout(()=>byId(decision.focus_id)?.focus(),0);return false;
    }
  }
  setActionStatus(byId('workflow-feedback'),'','');showDirect(name);return true;
}

function renderTabs(){
  const primary=node('div',{class:'primary-steps'},PRIMARY_STEPS.map(step=>{
    const control=button('',()=>show(step.id),'step-tab');control.dataset.tab=step.id;
    control.append(node('span',{class:'step-number',text:step.number}),node('span',{class:'step-copy'},[node('strong',{text:step.label}),node('span',{class:'step-state',text:'待完成'})]));return control;
  }));
  const utility=node('div',{class:'utility-tabs'},SECONDARY_DESTINATIONS.map(item=>{const control=button(item.label,()=>show(item.id),'tab utility');control.dataset.tab=item.id;return control;}));
  clear(byId('tabs'),node('div',{class:'navigation-row'},[primary,utility]),node('div',{id:'workflow-feedback',class:'action-status navigation-feedback',role:'status','aria-live':'polite'}));
  showDirect('source');
}

function renderSource(){
  const url=node('input',{id:'source-url',type:'url',placeholder:'https://github.com/D-Robotics/moss',autocomplete:'off'});url.value=state.sourceDraft.url;
  const ref=node('input',{id:'source-ref',type:'text',autocomplete:'off'});ref.value=state.sourceDraft.ref||'main';
  const local=node('input',{id:'source-local',type:'text',placeholder:'尚未选择项目文件夹',readonly:true});local.value=state.sourceDraft.local;
  url.addEventListener('input',()=>{state.sourceDraft.url=url.value;clearFieldError('source-url');});
  ref.addEventListener('input',()=>{state.sourceDraft.ref=ref.value;clearFieldError('source-ref');});
  local.addEventListener('input',()=>{state.sourceDraft.local=local.value;clearFieldError('source-local');});
  const sourceStatus=node('div',{id:'source-action-status',class:'action-status',role:'status','aria-live':'polite',text:'选择代码来源后，客户端会自动识别 Agent 和运行入口。'});
  const githubMode=button('GitHub 仓库',()=>{state.sourceMode='github';renderSource();},`source-mode ${state.sourceMode==='github'?'active':''}`);githubMode.setAttribute('aria-pressed',String(state.sourceMode==='github'));
  const localMode=button('本地文件夹',()=>{state.sourceMode='local';renderSource();},`source-mode ${state.sourceMode==='local'?'active':''}`);localMode.setAttribute('aria-pressed',String(state.sourceMode==='local'));
  const chooseLocal=button('选择项目文件夹',async()=>{
    await runAction({control:chooseLocal,busyLabel:'正在打开…',status:sourceStatus,busyText:'正在打开文件夹选择器',successText:(result)=>result?'已选择项目文件夹':'未更改项目文件夹',work:async()=>{const result=await api.selectDirectory();if(result.canceled)return false;state.sourceDraft.local=result.filePaths[0]||'';local.value=state.sourceDraft.local;clearFieldError('source-local');return Boolean(state.sourceDraft.local);}});
  },'secondary');chooseLocal.id='choose-local-source';
  const analyze=button('导入并分析',async()=>{
    const validation=validateSourceSelection({mode:state.sourceMode,url:url.value,directory:local.value});
    if(validation){showFieldError(validation.field,validation.message);setActionStatus(sourceStatus,'failure',validation.message);return;}
    const result=await runAction({control:analyze,busyLabel:'正在分析…',status:sourceStatus,busyText:'正在创建安全的评测副本…',successText:'项目分析完成，可以继续配置评测',work:async(update)=>{
      state.sourceDraft={url:url.value,ref:ref.value||'main',local:local.value};
      const record=state.sourceMode==='local'?await api.addLocalSource(local.value):await api.addGithubSource(url.value,ref.value||'main');
      update('代码副本已创建，正在识别 Agent 和运行方式…');
      const inspection=await api.inspect(record);
      state.sourceRecord=record;state.inspection=inspection;state.prepared=null;state.activeRun=null;
      renderInspection();renderConfigure();renderLive();updateNavigationState();return record;
    }});
    if(result)toast('项目分析完成，原项目不会被修改');
  },'primary large');analyze.id='analyze-source';
  const sourceForm=state.sourceMode==='github'
    ? node('div',{class:'stack'},[field('GitHub 仓库地址',url),node('details',{class:'advanced'},[node('summary',{text:'高级设置'}),field('分支、标签或 Commit',ref)]),analyze])
    : node('div',{class:'stack'},[field('Agent 项目文件夹',local),node('div',{class:'row'},[chooseLocal,analyze])]);
  clear(byId('source'),node('div',{class:'guided-page'},[
    node('section',{class:'hero'},[node('span',{class:'eyebrow',text:'第 1 步，共 3 步'}),node('h2',{text:'你想评测哪个 Agent？'}),node('p',{text:'选择一个 GitHub 仓库或电脑上的项目文件夹，客户端会先自动分析它是否可以评测。'})]),
    node('article',{class:'card source-card'},[node('div',{class:'source-modes',role:'group','aria-label':'代码来源'},[githubMode,localMode]),sourceForm,node('div',{class:'safety-note'},[node('strong',{text:'原项目不会被修改'}),node('span',{text:'评测会使用一份安全副本，并在隔离环境中运行。'})]),sourceStatus]),
    node('article',{class:'card analysis-card'},[node('h2',{text:'项目分析结果'}),node('div',{id:'inspection-content',class:'empty-state',text:'尚未分析项目。完成后这里会显示识别到的 Agent 类型和下一步。'})])
  ]));
  if(state.inspection)renderInspection();
}

function renderInspection(){
  const target=byId('inspection-content'); if(!target)return;
  const candidates=state.inspection?.candidates||[];
  const primary=candidates[0];
  const project=state.sourceRecord.type==='github'?String(state.sourceRecord.canonical_location||state.sourceRecord.original_input).replace(/\.git$/,''):state.sourceRecord.canonical_location;
  const version=state.sourceRecord.requested_ref||state.sourceRecord.git?.branch||state.sourceRecord.revision?.slice(0,12)||'当前本地内容';
  const entries=(primary?.entry_points||[]).map(entry=>entry.path).filter(Boolean);
  clear(target,node('div',{class:'stack'},[
    node('div',{class:'result-heading'},[node('span',{class:`result-icon ${primary?'success':'warning'}`,text:primary?'✓':'!'}),node('div',{},[node('h3',{text:primary?'项目可以继续配置':'需要确认 Agent 的运行方式'}),node('p',{class:'muted',text:primary?'已创建安全副本并完成自动识别。':'客户端没有找到可信的默认入口，你可以在下一步使用高级配置。'})])]),
    node('dl',{class:'summary-list'},[
      node('div',{},[node('dt',{text:'项目'}),node('dd',{text:project})]),
      node('div',{},[node('dt',{text:'Agent 类型'}),node('dd',{text:primary?.adapter||'需要手动确认'})]),
      node('div',{},[node('dt',{text:'运行入口'}),node('dd',{text:entries.join('、')||'下一步确认'})]),
      node('div',{},[node('dt',{text:'来源版本'}),node('dd',{text:version})]),
    ]),
    node('div',{class:'row'},[button('继续配置评测',()=>show('configure'),'primary large'),button('重新选择项目',()=>{state.sourceRecord=null;state.inspection=null;state.prepared=null;renderSource();renderConfigure();updateNavigationState();})]),
    node('details',{class:'technical-details'},[node('summary',{text:'查看技术详情'}),node('p',{class:'muted',text:'包含来源记录、版本、内部标识、Adapter 检测证据和入口协议。'}),json({source:state.sourceRecord,inspection:state.inspection})])
  ]));
}

function renderConfigure(){
  const draft=state.configureDraft||state.pendingPreparation?.draft||{};
  const defaultManifest=state.inspection?.manifest||{schema_version:'1.0',adapter:{id:'manifest-command',api_version:'1.0'},runtime:'node',preparation:{working_directory:'.',steps:[]},launch:{command:'agent',args:[],protocol:'stream-json'},capabilities:{modes:['stream-json'],telemetry_level:'L0',tools:[],tags:[]},environment:{required:[],optional:[],secrets:[]},network:{preparation_required:false,runtime_required:false,allowed_hosts:[]},sandbox:{privileged:false,docker_socket:false,host_mounts:[]}};
  const adapter=node('select',{id:'adapter'});
  for(const id of [...new Set([...(state.inspection?.candidates||[]).map(item=>item.adapter),'moss','manifest-command'])])adapter.append(node('option',{value:id,text:id}));
  adapter.value=draft.adapter_id||state.inspection?.candidates?.[0]?.adapter||'moss';
  const manifestConfig=node('textarea',{id:'manifest-config'});manifestConfig.value=draft.manifest_config||JSON.stringify(defaultManifest,null,2);
  const baseImage=node('input',{id:'base-image',type:'text'});baseImage.value=draft.base_image||'node:22-bookworm';
  const buildNetwork=node('input',{id:'build-network',type:'checkbox',checked:Boolean(draft.approve_network)});
  const trials=node('input',{id:'trials',type:'number',min:1,max:20});trials.value=String(draft.trials??1);
  const concurrency=node('input',{id:'concurrency',type:'number',min:1,max:8});concurrency.value=String(draft.concurrency||1);
  const suite=node('select',{id:'suite'});for(const s of ['release','capability','nightly'])suite.append(node('option',{value:s,text:s}));suite.value=draft.suite||'release';
  const telemetry=node('select',{id:'telemetry'});for(const l of ['L0','L1','L2','L3'])telemetry.append(node('option',{value:l,text:l}));telemetry.value=draft.telemetry||'L3';
  const runtimeSecrets=node('input',{id:'runtime-secrets',type:'text'});runtimeSecrets.value=draft.runtime_secrets??'ANTHROPIC_API_KEY,OPENAI_API_KEY';
  const approveSecrets=node('input',{id:'approve-runtime-secrets',type:'checkbox',checked:Boolean(draft.approve_runtime_secrets)});
  const approveRuntimeNetwork=node('input',{id:'approve-runtime-network',type:'checkbox',checked:Boolean(draft.approve_runtime_network)});
  const approveAgentActions=node('input',{id:'approve-agent-actions',type:'checkbox',checked:Boolean(draft.approve_agent_workspace_actions)});
  const modelBaseUrl=node('input',{id:'model-base-url',type:'url',autocomplete:'off',placeholder:'https://api.example.com/v1'});modelBaseUrl.value=draft.model_base_url??'';
  const modelApiKey=node('input',{id:'model-api-key',type:'password',autocomplete:'new-password',placeholder:'仅本次运行使用，不保存'});
  const modelName=node('input',{id:'model-name',type:'text',autocomplete:'off',placeholder:'例如 deepseek-v4-flash'});modelName.value=draft.model_name??'';
  const modelProtocol=node('select',{id:'model-protocol'});
  for(const [value,label] of [['auto','自动识别（推荐）'],['openai-compatible','OpenAI Compatible'],['anthropic','Anthropic']])modelProtocol.append(node('option',{value,text:label}));
  modelProtocol.value=draft.model_protocol||(draft.model_provider==='anthropic'?'anthropic':'auto');
  const protocolStatus=node('p',{id:'model-protocol-status',class:'hint'});
  const connectionStatus=node('div',{id:'model-connection-status',class:'action-status',role:'status','aria-live':'polite',text:'填写配置后可以先测试连接。'});
  const preparationStatus=node('div',{id:'preparation-action-status',class:'action-status',role:'status','aria-live':'polite',text:state.prepared?.target?'隔离评测环境已准备完成。':'确认后创建一次性评测环境。'});
  const configurationStatus=node('div',{id:'configuration-action-status',class:'action-status',role:'status','aria-live':'polite',text:state.prepared?.target?'配置已具备启动条件。':'下一步：填写模型配置并准备运行环境。'});
  const random=node('input',{id:'randomize',type:'checkbox',checked:draft.randomize!==false});
  const review=node('input',{id:'review-confirm',type:'checkbox',checked:Boolean(draft.confirmed)});
  const modelState=node('span',{id:'model-step-state',class:'step-badge pending',text:'待填写'});
  const preparationState=node('span',{id:'preparation-step-state',class:'step-badge pending',text:'待准备'});
  const runState=node('span',{id:'run-step-state',class:'step-badge pending',text:'待确认'});

  const updateProtocolStatus=()=>{
    const resolved=inferApiProtocol(modelBaseUrl.value,modelProtocol.value);
    const label=resolved==='anthropic'?'Anthropic Messages':'OpenAI Compatible';
    protocolStatus.textContent=modelProtocol.value==='auto'?`已自动识别 API 协议：${label}`:`已手动选择 API 协议：${label}`;
  };
  const updateSectionStates=()=>{
    const moss=adapter.value==='moss';
    const modelComplete=!moss||(Boolean(modelBaseUrl.value.trim())&&Boolean(modelApiKey.value.trim())&&Boolean(modelName.value.trim())&&approveRuntimeNetwork.checked);
    modelState.textContent=modelComplete?'配置完整':'待填写';modelState.className=`step-badge ${modelComplete?'complete':'pending'}`;
    const prepared=Boolean(state.prepared?.target);preparationState.textContent=prepared?'已准备':state.doctor?.ready?'可准备':'环境待处理';preparationState.className=`step-badge ${prepared?'complete':state.doctor?.ready?'ready':'pending'}`;
    const authorized=!moss||approveAgentActions.checked;runState.textContent=modelComplete&&prepared&&authorized?'可以开始':'待完成';runState.className=`step-badge ${modelComplete&&prepared&&authorized?'complete':'pending'}`;
    if(!modelComplete)setActionStatus(configurationStatus,'','下一步：填写模型 URL、API Key、模型名并授权联网。');
    else if(!prepared)setActionStatus(configurationStatus,'','下一步：在右侧准备一次性评测环境。');
    else if(!authorized)setActionStatus(configurationStatus,'','下一步：允许 Agent 操作隔离副本。');
    else setActionStatus(configurationStatus,'success','设置完整，可以开始评测。');
  };
  modelProtocol.addEventListener('change',()=>{updateProtocolStatus();setActionStatus(connectionStatus,'','配置已更改，请重新测试连接');updateSectionStates();});
  modelName.addEventListener('input',()=>{clearFieldError('model-name');setActionStatus(connectionStatus,'','配置已更改，请重新测试连接');updateSectionStates();});
  modelBaseUrl.addEventListener('input',()=>{clearFieldError('model-base-url');updateProtocolStatus();setActionStatus(connectionStatus,'','配置已更改，请重新测试连接');updateSectionStates();});
  modelApiKey.addEventListener('input',()=>{clearFieldError('model-api-key');setActionStatus(connectionStatus,'','配置已更改，请重新测试连接');updateSectionStates();});
  approveRuntimeNetwork.addEventListener('change',()=>{clearFieldError('approve-runtime-network');updateSectionStates();});
  approveAgentActions.addEventListener('change',()=>{clearFieldError('approve-agent-actions');updateSectionStates();});
  updateProtocolStatus();

  const captureDraft=()=>({adapter_id:adapter.value,manifest_config:manifestConfig.value,base_image:baseImage.value,approve_network:buildNetwork.checked,confirmed:review.checked,trials:Number(trials.value),concurrency:Number(concurrency.value),suite:suite.value,telemetry:telemetry.value,runtime_secrets:runtimeSecrets.value,approve_runtime_secrets:approveSecrets.checked,approve_runtime_network:approveRuntimeNetwork.checked,approve_agent_workspace_actions:approveAgentActions.checked,model_protocol:modelProtocol.value,model_name:modelName.value,model_base_url:modelBaseUrl.value,randomize:random.checked});
  const currentModelConfiguration=()=>{
    if(adapter.value!=='moss')return null;
    const validation=validateModelInputs({model:modelName.value,baseUrl:modelBaseUrl.value,apiKey:modelApiKey.value,networkApproved:approveRuntimeNetwork.checked});
    if(validation){showFieldError(validation.field,validation.message);throw Object.assign(new Error(validation.message),{code:'MODEL_INPUT_REQUIRED'});}
    return {protocol:modelProtocol.value,model:modelName.value.trim(),base_url:modelBaseUrl.value.trim(),api_key:modelApiKey.value};
  };
  const makePreparationRequest=()=>{
    if(!state.sourceRecord)throw Object.assign(new Error('请先选择并分析要评测的 Agent'),{code:'SOURCE_REQUIRED'});
    if(!review.checked){showFieldError('review-confirm','请确认客户端可以根据以上设置准备评测环境');throw Object.assign(new Error('请确认客户端可以根据以上设置准备评测环境'),{code:'REVIEW_REQUIRED'});}
    const configuration=adapter.value==='manifest-command'?JSON.parse(manifestConfig.value):{};
    return {preparation_id:`prepare-${Date.now()}`,confirmed:true,approve_network:buildNetwork.checked,source_record:state.sourceRecord,adapter_id:adapter.value,configuration,base_image:baseImage.value,sandbox_policy:{cpu:2,memory_mb:4096,pids:256,disk_mb:4096,timeout_seconds:600},runtime:{kind:'docker'}};
  };
  let prepareButton,startButton,testConnectionButton;
  const prepare=async()=>{
    await runAction({control:prepareButton,busyLabel:'正在准备…',status:preparationStatus,busyText:'正在创建隔离的评测环境，这可能需要几分钟…',successText:()=>state.doctor?.ready?'评测环境准备完成，可以继续测试模型连接。':'设置已保存，运行环境就绪后会自动继续。',work:async()=>{
      state.configureDraft=captureDraft();const request=makePreparationRequest();
      if(!state.doctor?.ready){savePendingPreparation({schema_version:'1.0',saved_at:new Date().toISOString(),source_record:state.sourceRecord,inspection:state.inspection,draft:state.configureDraft,request});startDoctorPolling();return null;}
      return executePreparation(request);
    }});
    updateSectionStates();
  };
  const startRun=async()=>{
    let model_configuration=null;
    try{model_configuration=currentModelConfiguration();}catch(error){setActionStatus(configurationStatus,'failure',friendlyError(error));return;}
    if(adapter.value==='moss'&&!approveAgentActions.checked){const message='请允许 Agent 在隔离评测副本中修改文件并运行测试；原项目不会被修改';showFieldError('approve-agent-actions',message);setActionStatus(configurationStatus,'failure',message);return;}
    if(!state.prepared?.target){showFieldError('prepare-target','请先准备一次性评测环境');setActionStatus(configurationStatus,'failure','模型设置已填写；现在请在右侧准备评测环境。');return;}
    await runAction({control:startButton,busyLabel:'正在启动…',status:configurationStatus,busyText:'正在启动评测并打开实时状态…',successText:'评测已经启动',work:async()=>{
      state.configureDraft=captureDraft();const approved_secret_names=approveSecrets.checked?runtimeSecrets.value.split(',').map(v=>v.trim()).filter(Boolean):[];
      const started=await api.startRun({config_id:'moss.example.json',target_fingerprint:state.prepared.target.target_fingerprint,approved_secret_names,approve_runtime_network:approveRuntimeNetwork.checked,approve_agent_workspace_actions:approveAgentActions.checked,model_configuration,suite:suite.value,trials:Number(trials.value),concurrency:Number(concurrency.value),k:Number(trials.value),randomize:random.checked,minimum_telemetry_level:telemetry.value});
      modelApiKey.value='';state.activeRun=started.run_id;state.events=[];renderLive();updateNavigationState();show('live');return started;
    }});
  };
  const testConnection=async()=>{
    let model_configuration;
    try{model_configuration=currentModelConfiguration();}catch(error){setActionStatus(connectionStatus,'failure',friendlyError(error));return;}
    if(!state.prepared?.target){showFieldError('prepare-target','请先准备评测环境');setActionStatus(connectionStatus,'failure','请先准备评测环境，再测试模型连接');return;}
    await runAction({control:testConnectionButton,busyLabel:'正在测试…',status:connectionStatus,busyText:'正在通过隔离环境连接模型服务…',successText:(result)=>`连接成功 · HTTP ${result.status} · ${result.latency_ms} ms`,work:async()=>{
      const result=await api.testModelConnection({target_fingerprint:state.prepared.target.target_fingerprint,approve_runtime_network:approveRuntimeNetwork.checked,model_configuration});
      if(!result.ok)throw Object.assign(new Error(`连接失败${result.status?`，HTTP ${result.status}`:''}。请检查 API Key、Model 和 Base URL`),{code:result.error_code||'MODEL_CONNECTION_FAILED'});return result;
    }});
  };
  prepareButton=button(state.prepared?.target?'重新准备评测环境':state.doctor?.ready?'准备评测环境':'保存设置并等待环境就绪',prepare,'primary');prepareButton.id='prepare-target';
  startButton=button('开始评测',startRun,'primary large');startButton.id='start-evaluation';
  testConnectionButton=button('测试连接',testConnection);testConnectionButton.id='test-model-connection';

  const modelConfigurationPanel=node('div',{id:'moss-model-configuration',class:'stack'},[
    node('div',{class:'form-grid model-fields'},[
      field('Base URL',modelBaseUrl,'field-span-2'),field('API Key',modelApiKey),field('模型名',modelName),
    ]),
    protocolStatus,
    node('details',{class:'advanced'},[node('summary',{text:'高级设置'}),field('API 协议',modelProtocol),node('p',{class:'hint',text:'大多数自定义网关使用 OpenAI Compatible；只有兼容 Anthropic Messages 的网关才需要手动切换。'})]),
    node('div',{class:'inline-action'},[testConnectionButton,connectionStatus]),
    node('p',{class:'hint',text:'API Key 只在本次评测中使用，不会保存到客户端设置、日志或报告。评测结束后，临时配置会自动删除。'}),
  ]);
  const genericSecretsPanel=node('div',{id:'generic-runtime-secrets',class:'stack'},[field('声明的运行时 secret 名称（不填写值）',runtimeSecrets),node('label',{class:'check'},[approveSecrets,text('本次 Run 授权注入上述已配置环境变量')])]);
  const agentActionsAuthorization=node('div',{id:'agent-actions-authorization',class:'authorization-box'},[node('label',{class:'check'},[approveAgentActions,text('允许 Agent 修改评测副本并运行测试')]),node('p',{class:'hint',text:'只影响 Docker 中的一次性副本，不会修改你选择的原项目。MOSS 需要这项授权才能真正完成编码任务。'}),node('span',{id:'approve-agent-actions-error',class:'field-error',role:'alert'})]);
  const updateAdapterConfiguration=()=>{const moss=adapter.value==='moss';modelConfigurationPanel.hidden=!moss;agentActionsAuthorization.hidden=!moss;genericSecretsPanel.hidden=moss;updateSectionStates();};
  adapter.addEventListener('change',updateAdapterConfiguration);updateAdapterConfiguration();

  const detectedAdapter=state.inspection?.candidates?.[0]?.adapter||adapter.value;
  clear(byId('configure'),node('div',{class:'guided-page'},[
    node('section',{class:'hero configure-hero'},[node('span',{class:'eyebrow',text:'第 2 步，共 3 步'}),node('h2',{text:'配置这次评测'}),node('p',{text:`已识别 ${detectedAdapter}。填写模型连接，确认运行方式，然后开始评测。高级参数已收起。`})]),
    node('div',{class:'configuration-layout'},[
      node('article',{id:'model-configuration-card',class:'card configuration-card'},[
        node('div',{class:'section-heading'},[
          node('div',{class:'section-number',text:'1'}),
          node('div',{class:'section-title'},[node('h2',{text:'连接模型服务'}),node('p',{class:'muted',text:'只需要 URL、API Key 和模型名。'})]),
          modelState,
        ]),
        node('div',{class:'stack'},[
          modelConfigurationPanel,genericSecretsPanel,
          node('div',{class:'authorization-line'},[
            node('label',{class:'check network-approval'},[approveRuntimeNetwork,text('允许评测时访问模型公网')]),
            node('span',{id:'approve-runtime-network-error',class:'field-error',role:'alert'}),
          ]),
        ]),
      ]),
      node('aside',{class:'configuration-rail','aria-label':'运行环境与隔离准备'},[
        node('article',{id:'prerequisite-panel',class:'card runtime-card'}),
        node('article',{id:'preparation-card',class:'card preparation-card'},[
          node('div',{class:'section-heading compact-heading'},[
            node('div',{class:'section-number',text:'✓'}),
            node('div',{class:'section-title'},[node('h2',{text:'隔离评测环境'}),node('p',{class:'muted',text:'原项目不会被修改。'})]),
            preparationState,
          ]),
          node('div',{class:'stack compact-stack'},[
            node('label',{class:'check'},[buildNetwork,text('构建时允许联网安装依赖')]),
            node('label',{class:'check'},[review,text('确认使用当前项目和设置')]),node('span',{id:'review-confirm-error',class:'field-error',role:'alert'}),
            node('div',{class:'row'},[prepareButton,button('取消',safely(async()=>{if(state.preparationId)await api.cancelPreparation(state.preparationId);else if(state.pendingPreparation){clearPendingPreparation();stopDoctorPolling();toast('已取消自动继续');}else toast('当前没有正在准备的环境');}),'danger')]),
            node('span',{id:'prepare-target-error',class:'field-error',role:'alert'}),preparationStatus,
            node('details',{class:'technical-details'},[node('summary',{text:'高级运行设置'}),field('Adapter',adapter),field('Manifest 配置',manifestConfig),field('基础镜像',baseImage),json({runtime_network:'disabled by default',secrets:'named authorization only',cpu:2,memory_mb:4096,pids:256,disk_mb:4096,wall_seconds:600})]),
          ]),
        ]),
      ]),
      node('article',{id:'run-configuration-card',class:'card configuration-card'},[
        node('div',{class:'section-heading'},[
          node('div',{class:'section-number',text:'2'}),
          node('div',{class:'section-title'},[node('h2',{text:'确认并开始'}),node('p',{class:'muted',text:'默认设置适合第一次完整评测。'})]),
          runState,
        ]),
        node('div',{class:'compact-field-grid'},[field('任务集',suite),field('每条任务尝试次数',trials)]),
        node('p',{class:'hint',text:'建议先运行 1 次；提高次数可测稳定性，但会增加时间和模型费用。'}),
        node('details',{class:'advanced run-advanced'},[
          node('summary',{text:'更多评测设置'}),
          node('div',{class:'compact-field-grid'},[field('并发任务数',concurrency),field('轨迹详细度',telemetry)]),
          node('label',{class:'check'},[random,text('随机排列任务顺序')]),
          node('p',{class:'muted',text:'release 是经过校验的正式任务集；能力不匹配的任务会标记为“不适用”，不会算作失败。'}),
        ]),
        agentActionsAuthorization,
        node('div',{class:'start-bar'},[
          node('div',{class:'start-copy'},[node('strong',{text:'准备好后即可开始'}),configurationStatus]),
          startButton,
        ]),
      ]),
    ]),
  ]));
  renderPrerequisites();
  updateSectionStates();
}

function eventRunId(event){return event?.data?.run_id||event?.data?.runId||null}
function renderLive(){
  const related=state.events.filter(e=>!state.activeRun||eventRunId(e)===state.activeRun);
  const completed=related.filter(e=>e.type==='trial_completed'); const passed=completed.filter(e=>e.data?.trial?.success).length;
  const active=related.filter(e=>e.type==='trial_started').length-completed.length;
  const terminal=related.findLast?.(event=>event.type==='run_completed'||event.type==='run_failed')||[...related].reverse().find(event=>event.type==='run_completed'||event.type==='run_failed');
  if(!state.activeRun){
    clear(byId('live'),node('div',{class:'guided-page'},[node('section',{class:'hero'},[node('span',{class:'eyebrow',text:'第 3 步，共 3 步'}),node('h2',{text:'运行与结果'}),node('p',{text:'评测启动后，这里会显示实时进度、通过数量和最终报告入口。'})]),node('article',{class:'card full empty-state'},[node('h3',{text:'还没有开始评测'}),node('p',{class:'muted',text:state.prepared?.target?'评测环境已经准备好，返回配置页检查模型后即可开始。':'请先完成项目分析和评测环境准备。'}),button(state.prepared?.target?'返回配置并开始':'返回上一步',()=>show(state.prepared?.target?'configure':'source'),'primary')]) ]));return;
  }
  const recent=groupTrialsByTask(completed.map(event=>event.data?.trial).filter(Boolean)).slice(-8).reverse();
  clear(byId('live'),node('div',{class:'guided-page'},[
    node('section',{class:'hero'},[node('span',{class:'eyebrow',text:'第 3 步，共 3 步'}),node('h2',{text:terminal?(terminal.type==='run_completed'?'评测已完成':'评测未能完成'):'评测正在运行'}),node('p',{text:terminal?'你可以查看任务结果和详细报告。':'可以留在此页面查看进度；关闭窗口后仍可从历史记录恢复结果。'})]),
    node('div',{class:'grid'},[
      ...[['评测编号',state.activeRun],['已完成执行',completed.length],['通过执行',passed],['正在运行',Math.max(0,active)]].map(([k,v])=>node('article',{class:'card third'},[node('div',{class:'muted',text:k}),node('div',{class:k==='评测编号'?'run-id':'metric',text:v})])),
      node('article',{class:'card full'},[node('div',{class:'row between'},[node('h2',{text:'最近任务'}),terminal?button('查看完整报告',safely(async()=>{state.selectedRun=await api.getRun(state.activeRun);show('report');renderReport();}),'primary'):button('停止评测',safely(async()=>{await api.cancelRun(state.activeRun);toast('已请求停止评测');}),'danger')]),recent.length?node('div',{class:'result-list'},recent.map(task=>{const failure=friendlyFailure(task.main_failure);const invalid=task.valid===0;const stateClass=invalid?'invalid':task.passed?'pass':task.outcomes?'partial':'fail';const resultLabel=invalid?`评测无效 0/${task.attempts}`:task.outcomes?`结果通过 ${task.outcomes}/${task.attempts}`:`结果未通过 0/${task.attempts}`;return node('div',{class:`result-row ${stateClass}`},[node('strong',{text:resultLabel}),node('span',{text:`${task.id} · ${task.title}`}),node('span',{class:'muted',text:task.passed?'全部约束通过':invalid?`Agent 未有效启动 · ${failure.title}`:task.outcomes?`结果已完成 · ${failure.title}`:failure.title})]);})):node('p',{class:'empty-state',text:'评测已经启动，正在等待第一条任务结果…'})]),
      node('article',{class:'card full'},[node('details',{class:'technical-details'},[node('summary',{text:'查看实时技术轨迹'}),node('p',{class:'muted',text:'用于排查问题的原始事件、时间戳和运行字段。'}),node('div',{},related.slice(-100).reverse().map(e=>node('div',{class:`event ${e.data?.trial?.success?'pass':e.type==='run_failed'?'fail':''}`},[node('strong',{text:e.type}),node('span',{class:'muted',text:` ${e.timestamp||''}`}),node('pre',{text:JSON.stringify(e.data,null,2)})])))])])
    ])
  ]));
}

async function loadHistory(){ state.runs=await api.listRuns(); renderHistory(); }
function renderHistory(){
  const labels={completed:'已完成',interrupted:'已中断',cancelled:'已取消',corrupt:'数据损坏',running:'运行中'};
  const rows=state.runs.map(run=>node('tr',{},[node('td',{text:run.id}),node('td',{},[node('span',{class:`status ${run.status==='completed'?'ok':run.status==='corrupt'?'bad':'warn'}`,text:labels[run.status]||run.status})]),node('td',{text:run.metadata?.trial_count??'—'}),node('td',{},[button('查看结果',safely(async()=>{state.selectedRun=await api.getRun(run.id);show('report');renderReport();}))]) ]));
  clear(byId('history'),node('article',{class:'card full'},[node('h2',{text:'运行历史'}),node('p',{class:'muted',text:'每次评测都保留脱敏的任务结果和诊断证据，可以随时回来查看。'}),node('table',{class:'table'},[node('thead',{},[node('tr',{},['评测编号','状态','执行次数','操作'].map(v=>node('th',{text:v})))]),node('tbody',{},rows)])]));
}

function runTaskMap(run){return new Map((run?.trials||[]).map(t=>[`${t.task.id}/${t.agent}/${t.replicate}`,t]));}
async function compareSelected(){const a=byId('baseline').value,b=byId('candidate').value;if(!a||!b)return;const [left,right]=await Promise.all([api.getRun(a),api.getRun(b)]);const lm=runTaskMap(left),rm=runTaskMap(right);const common=[...lm.keys()].filter(k=>rm.has(k));const regressions=common.filter(k=>lm.get(k).success&&!rm.get(k).success);const target=byId('comparison');clear(target,json({common_eligible_trials:common.length,regressions,coverage_delta:(right.trials?.length||0)-(left.trials?.length||0)}));}
function renderReport(){
  const run=state.selectedRun; const ids=state.runs.map(r=>r.id); const baseline=node('select',{id:'baseline'}),candidate=node('select',{id:'candidate'}); for(const id of ids){baseline.append(node('option',{value:id,text:id}));candidate.append(node('option',{value:id,text:id}));}
  if(ids[1])baseline.value=ids[1];if(ids[0])candidate.value=ids[0];
  const diagnosis=diagnoseRun(run);const agentSummary=run?.summary?.agents?.[0]||{};const release=releasePresentation(run?.release_decision||run?.report?.release_decision||run?.metadata?.release_decision);
  const percent=(value)=>Number.isFinite(value)?`${(value*100).toFixed(1)}%`:'暂无';
  const rateLine=(key,label)=>{const metric=agentSummary[key];if(!metric)return null;const fraction=Number.isFinite(metric.successes)&&Number.isFinite(metric.total)?`${metric.successes}/${metric.total}`:'分母暂无';return node('div',{class:'metric-explanation'},[node('div',{class:'row between'},[node('strong',{text:label}),node('span',{class:'metric-value',text:percent(metric.value)})]),node('p',{text:`${fraction} · ${explainMetric(key)}`})]);};
  const taskRows=diagnosis.tasks.map(task=>{const failure=friendlyFailure(task.main_failure);const invalid=task.valid===0;const label=invalid?'评测无效':task.passed?'全部约束通过':task.outcomes?'结果通过，约束未全过':'结果未通过';const statusClass=task.passed?'ok':task.outcomes||invalid?'warn':'bad';return node('tr',{},[node('td',{},[node('strong',{text:task.id}),node('div',{class:'muted',text:task.title})]),node('td',{text:`${task.outcomes}/${task.attempts}`}),node('td',{},[node('span',{class:`status ${statusClass}`,text:label})]),node('td',{},[node('strong',{text:task.passed?'—':failure.title}),task.passed?text(''):node('div',{class:'muted',text:failure.description})]),node('td',{},[node('details',{class:'inline-details'},[node('summary',{text:'查看证据'}),json(task.trials.map(trial=>({replicate:trial.replicate,status:trial.status,outcome_passed:trial.outcome_passed,safety_passed:trial.safety_passed,failure_category:trial.failure_category,adapter_diagnostic:trial.adapter_diagnostic,graders:trial.graders,metrics:trial.metrics,workspace_diff:trial.workspace_diff})))])])]);});
  const failureGroups=Object.entries(diagnosis.failure_counts).sort((a,b)=>b[1]-a[1]).map(([category,count])=>{const failure=friendlyFailure(category);return node('div',{class:'failure-group'},[node('div',{class:'failure-count',text:count}),node('div',{},[node('strong',{text:failure.title}),node('p',{text:failure.description}),node('p',{class:'hint',text:`建议：${failure.action}`})])]);});
  const toolQuality=agentSummary.tools?.quality;
  const toolMetrics=toolQuality
    ? [['tool_precision','工具精确率',toolQuality.macro_precision],['tool_recall','工具召回率',toolQuality.macro_recall],['tool_f1','工具 F1',toolQuality.macro_f1]].map(([key,label,value])=>
      node('div',{class:'metric-explanation'},[
        node('div',{class:'row between'},[node('strong',{text:label}),node('span',{class:'metric-value',text:percent(value)})]),
        node('p',{text:`${toolQuality.eligible_trials??'—'} 条可评执行 · ${explainMetric(key)}`}),
      ]))
    : [];
  const advancedMetrics=[
    rateLine('valid_trial_rate','有效执行率'),rateLine('outcome_pass_rate','结果通过率'),rateLine('trial_success_rate','完整通过率'),rateLine('pass_at_1','Pass@1'),rateLine('pass_at_k','Pass@k'),rateLine('pass_pow_k','Pass^k'),rateLine('safety_violation_rate','安全违规率'),rateLine('recovery_success_rate','异常恢复成功率'),
    ...toolMetrics,
  ].filter(Boolean);
  clear(byId('report'),node('div',{class:'grid'},[
    node('article',{class:'card full'},[node('div',{class:'row between'},[node('h2',{text:'评测结果'}),node('div',{class:'row'},[run?button('导出脱敏 JSON',safely(()=>api.exportRun(run.metadata?.run_id||run.id,'json'))):text(''),run?button('导出可读报告',safely(()=>api.exportRun(run.metadata?.run_id||run.id,'markdown'))):text('')])]),run?node('div',{class:'stack'},[
      node('section',{class:`diagnosis-card ${diagnosis.validity}`},[node('span',{class:'eyebrow',text:diagnosis.validity==='valid'?'结论有效性：可用':diagnosis.validity==='inconclusive'?'结论有效性：不可用':'结论有效性：不完整'}),node('h3',{text:diagnosis.title}),node('p',{text:diagnosis.description}),node('p',{class:'diagnosis-action',text:`下一步：${diagnosis.action}`})]),
      node('section',{class:`diagnosis-card ${release.eligible?'valid':'inconclusive'}`},[node('span',{class:'eyebrow',text:release.eligible?'发布状态：可正式发布':'发布状态：仅开发使用'}),node('h3',{text:release.title}),node('p',{text:release.description}),...(release.blockers.length?[node('ul',{},release.blockers.slice(0,8).map(value=>node('li',{text:value})))]:[]),...(release.dataset_digest||release.protocol_digest?[node('details',{class:'inline-details'},[node('summary',{text:'查看数据与协议身份'}),json({dataset_digest:release.dataset_digest,protocol_digest:release.protocol_digest})])]:[])]),
      node('p',{class:'run-summary-sentence',text:diagnosis.sentence}),
      node('div',{class:'summary-metrics'},[['任务数',diagnosis.task_count],['每条最多尝试',diagnosis.repetitions],['任务结果通过',`${diagnosis.outcome_passed_tasks}/${diagnosis.task_count}`],['安全检查通过',`${diagnosis.safety_passed_executions}/${diagnosis.total_executions}`],['全部约束通过',`${diagnosis.passed_executions}/${diagnosis.total_executions}`]].map(([label,value])=>node('div',{class:'summary-metric'},[node('span',{text:label}),node('strong',{text:value})]))),
      node('section',{class:'report-section'},[node('h3',{text:'主要原因'}),failureGroups.length?node('div',{class:'failure-groups'},failureGroups):node('p',{class:'muted',text:'没有失败记录。'})]),
      node('section',{class:'report-section'},[node('h3',{text:'逐条任务结果'}),node('p',{class:'muted',text:'“任务结果通过”表示目标已完成；“全部约束通过”还要求安全、预算等硬规则全部满足。重复尝试已合并。'}),node('div',{class:'table-scroll'},[node('table',{class:'table task-table'},[node('thead',{},[node('tr',{},['任务','结果通过/尝试','综合状态','主要原因','详情'].map(v=>node('th',{text:v})))]),node('tbody',{},taskRows)])])]),
      node('details',{class:'technical-details'},[node('summary',{text:'高级指标是什么意思？'}),node('p',{class:'muted',text:'这些指标用于研究稳定性、工具使用和安全性；日常判断请先看上面的结论和任务结果。'}),node('div',{class:'metric-explanations'},advancedMetrics)]),
      node('details',{class:'technical-details'},[node('summary',{text:'完整技术数据与原始 artifacts'}),node('p',{class:'muted',text:'包含原始 summary、grader、分母、置信区间、provenance 和脱敏轨迹引用。'}),json(run)])
    ]):node('p',{class:'muted',text:'从历史记录中选择一次评测查看。'})]),
    node('article',{class:'card full'},[node('h2',{text:'覆盖感知对比'}),node('div',{class:'row'},[field('基线',baseline),field('候选',candidate),button('比较共同 eligible 交集',safely(compareSelected),'primary')]),node('div',{id:'comparison',class:'muted',text:'对比不会把 NOT_APPLICABLE 当失败，并单列覆盖率变化。'})])
  ]));
}

api.onEvent((event)=>{state.events.push(event);const id=eventRunId(event);if(!state.activeRun&&id)state.activeRun=id;if(byId('live')&&!byId('live').hidden)renderLive();if(event.type==='run_completed'||event.type==='run_failed')loadHistory();});

state.pendingPreparation=loadPendingPreparation();
if(state.pendingPreparation){
  state.sourceRecord=state.pendingPreparation.source_record;
  state.inspection=state.pendingPreparation.inspection;
  state.configureDraft=state.pendingPreparation.draft||null;
}
renderTabs();renderSource();renderConfigure();renderLive();renderHistory();renderReport();
if(state.inspection)renderInspection();
safely(async()=>{await refreshDoctor();if(state.pendingPreparation&&!state.doctor?.ready)startDoctorPolling();})();
