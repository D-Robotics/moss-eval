const api = window.mossEval;
const tabs = [['source','1 源码与检查'],['configure','2 准备与配置'],['live','3 实时状态'],['history','历史'],['report','报告与对比']];
const state = { sourceRecord:null, inspection:null, prepared:null, preparationId:null, activeRun:null, runs:[], events:[], selectedRun:null };

const node = (tag, attrs = {}, children = []) => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'checked') element.checked = value;
    else if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
  element.append(...(Array.isArray(children) ? children : [children]));
  return element;
};
const text = (value) => document.createTextNode(String(value ?? ''));
const byId = (id) => document.getElementById(id);
const clear = (element, ...children) => element.replaceChildren(...children);
const field = (title, control) => node('label', {}, [text(title), control]);
const button = (label, action, className = '') => node('button', { type:'button', class:className, text:label, onclick:action });
const json = (value) => node('pre', { text: JSON.stringify(value, null, 2) });
const toast = (message) => { const target=byId('toast'); target.textContent=message; target.classList.add('show'); setTimeout(()=>target.classList.remove('show'),2600); };
const safely = (work) => async (...args) => { try { return await work(...args); } catch (error) { toast(`${error.code || 'ERROR'}: ${error.message}`); } };

function show(name) {
  for (const [id] of tabs) { byId(id).hidden=id!==name; document.querySelector(`[data-tab="${id}"]`).classList.toggle('active',id===name); }
  if(name==='history') loadHistory(); if(name==='report') renderReport();
}

function renderTabs(){ clear(byId('tabs'),...tabs.map(([id,label])=>button(label,()=>show(id),'tab'))); [...byId('tabs').children].forEach((item,index)=>item.dataset.tab=tabs[index][0]); show('source'); }

function renderSource(){
  const url=node('input',{id:'source-url',type:'url',placeholder:'https://github.com/D-Robotics/moss'});
  const ref=node('input',{id:'source-ref',type:'text',value:'main'}); ref.value='main';
  const local=node('input',{id:'source-local',type:'text',placeholder:'D:\\projects\\my-agent',readonly:true});
  clear(byId('source'),node('div',{class:'grid'},[
    node('article',{class:'card'},[node('h2',{text:'GitHub 仓库'}),node('div',{class:'stack'},[field('公开仓库 URL',url),field('分支、标签或提交',ref),button('获取不可变快照',safely(async()=>acceptSource(await api.addGithubSource(url.value,ref.value))),'primary')])]),
    node('article',{class:'card'},[node('h2',{text:'本地目录'}),node('div',{class:'stack'},[field('只读导入来源',local),node('div',{class:'row'},[button('选择目录',safely(async()=>{const r=await api.selectDirectory();if(!r.canceled)local.value=r.filePaths[0]||'';})),button('复制为隔离快照',safely(async()=>acceptSource(await api.addLocalSource(local.value))),'primary')])])]),
    node('article',{class:'card full'},[node('h2',{text:'来源与静态检查'}),node('div',{id:'inspection-content',class:'muted',text:'尚未选择来源。原目录不会被修改，也不会在检查阶段执行仓库代码。'})])
  ]));
}

async function acceptSource(record){ state.sourceRecord=record; state.inspection=await api.inspect(record); renderInspection(); renderConfigure(); toast('快照与静态检查已完成'); }
function renderInspection(){
  const target=byId('inspection-content'); if(!target)return;
  const candidates=state.inspection?.candidates||[];
  clear(target,node('div',{class:'stack'},[
    node('div',{class:'row'},[node('span',{class:`status ${state.inspection.status==='detected'?'ok':'warn'}`,text:state.inspection.status}),node('span',{text:`快照 ${state.sourceRecord.snapshot_fingerprint}`})]),
    node('h3',{text:'候选 Harness'}),...(candidates.length?candidates.map(c=>node('div',{class:'event'},[node('strong',{text:`${c.adapter} · ${c.confidence_label} (${c.confidence})`}),node('div',{class:'muted',text:(c.entry_points||[]).map(e=>`${e.path} [${e.protocol}]`).join(', ')||'未发现入口'})])):[node('p',{class:'warn',text:'未能自动确认 Harness，请在下一步使用引导配置并明确确认。'})]),
    node('details',{},[node('summary',{text:'查看检查证据与来源 provenance'}),json({source:state.sourceRecord,inspection:state.inspection})])
  ]));
}

function renderConfigure(){
  const adapter=node('select',{id:'adapter'}); for(const id of [...new Set([...(state.inspection?.candidates||[]).map(item=>item.adapter),'moss','manifest-command'])])adapter.append(node('option',{value:id,text:id}));
  adapter.value=state.inspection?.candidates?.[0]?.adapter||'moss';
  const manifestConfig=node('textarea',{id:'manifest-config'});manifestConfig.value=JSON.stringify(state.inspection?.manifest||{schema_version:'1.0',adapter:{id:'manifest-command',api_version:'1.0'},runtime:'node',preparation:{working_directory:'.',steps:[]},launch:{command:'agent',args:[],protocol:'stream-json'},capabilities:{modes:['stream-json'],telemetry_level:'L0',tools:[],tags:[]},environment:{required:[],optional:[],secrets:[]},network:{preparation_required:false,runtime_required:false,allowed_hosts:[]},sandbox:{privileged:false,docker_socket:false,host_mounts:[]}},null,2);
  const baseImage=node('input',{id:'base-image',type:'text'});baseImage.value='node:22-bookworm';
  const buildNetwork=node('input',{id:'build-network',type:'checkbox'});
  const trials=node('input',{id:'trials',type:'number',min:1,max:20});trials.value='3';
  const concurrency=node('input',{id:'concurrency',type:'number',min:1,max:8});concurrency.value='1';
  const suite=node('select',{id:'suite'}); for(const s of ['release','capability','nightly'])suite.append(node('option',{value:s,text:s}));
  const telemetry=node('select',{id:'telemetry'}); for(const l of ['L0','L1','L2','L3'])telemetry.append(node('option',{value:l,text:l}));telemetry.value='L3';
  const runtimeSecrets=node('input',{id:'runtime-secrets',type:'text'});runtimeSecrets.value='ANTHROPIC_API_KEY,OPENAI_API_KEY';
  const approveSecrets=node('input',{id:'approve-runtime-secrets',type:'checkbox'});
  const approveRuntimeNetwork=node('input',{id:'approve-runtime-network',type:'checkbox'});
  const random=node('input',{id:'randomize',type:'checkbox',checked:true});
  const review=node('input',{id:'review-confirm',type:'checkbox'});
  clear(byId('configure'),node('div',{class:'grid'},[
    node('article',{class:'card'},[node('h2',{text:'准备授权'}),node('div',{class:'stack'},[field('适配器',adapter),field('引导配置 / 仓库 Manifest 的有效投影',manifestConfig),field('受信任基础镜像（构建前解析为 digest）',baseImage),node('label',{class:'check'},[buildNetwork,text('允许构建阶段访问公网安装声明的依赖（Trial 仍默认断网）')]),json({runtime_network:'disabled',secrets:'named authorization only',cpu:2,memory_mb:4096,pids:256,disk_mb:4096,wall_seconds:600}),node('label',{class:'check'},[review,text('我已审阅检测证据、入口、构建网络、密钥和沙箱预算')]),node('div',{class:'row'},[button('确认并在 Docker 沙箱准备 Target',safely(async()=>{if(!state.sourceRecord)throw new Error('请先选择源码');const configuration=adapter.value==='manifest-command'?JSON.parse(manifestConfig.value):{};state.preparationId=`prepare-${Date.now()}`;try{state.prepared=await api.prepare({preparation_id:state.preparationId,confirmed:review.checked,approve_network:buildNetwork.checked,source_record:state.sourceRecord,adapter_id:adapter.value,configuration,base_image:baseImage.value,sandbox_policy:{cpu:2,memory_mb:4096,pids:256,disk_mb:4096,timeout_seconds:600},runtime:{kind:'docker'}});toast(state.prepared.reused?'复用已准备 Target':'Target 构建与准备完成');}finally{state.preparationId=null;}}),'primary'),button('取消准备',safely(async()=>{if(state.preparationId)await api.cancelPreparation(state.preparationId);else toast('当前没有活动准备');}),'danger')])])]),
    node('article',{class:'card'},[node('h2',{text:'评测配置'}),node('div',{class:'stack'},[field('任务集',suite),field('重复次数',trials),field('并发',concurrency),field('要求遥测覆盖',telemetry),field('声明的运行时 secret 名称（不填写值）',runtimeSecrets),node('label',{class:'check'},[approveSecrets,text('本次 Run 授权注入上述已配置环境变量')]),node('label',{class:'check'},[approveRuntimeNetwork,text('若 Harness manifest 声明需要，授权本次 Run 公网访问')]),node('label',{class:'check'},[random,text('随机化任务顺序')]),node('p',{class:'muted',text:'release 只统计 16 条已硬化 gated 任务；其余任务单列 experimental。能力不匹配显示 NOT_APPLICABLE，不进入通过率分母。'}),button('开始评测',safely(async()=>{if(!state.prepared?.target)throw new Error('请先审阅并准备 Target');const approved_secret_names=approveSecrets.checked?runtimeSecrets.value.split(',').map(v=>v.trim()).filter(Boolean):[];const started=await api.startRun({config_id:'moss.example.json',target_fingerprint:state.prepared.target.target_fingerprint,approved_secret_names,approve_runtime_network:approveRuntimeNetwork.checked,suite:suite.value,trials:Number(trials.value),concurrency:Number(concurrency.value),k:Number(trials.value),randomize:random.checked,minimum_telemetry_level:telemetry.value});state.activeRun=started.run_id;state.events=[];renderLive();show('live');}),'primary')])])
  ]));
}

function eventRunId(event){return event?.data?.run_id||event?.data?.runId||null}
function renderLive(){
  const related=state.events.filter(e=>!state.activeRun||eventRunId(e)===state.activeRun);
  const completed=related.filter(e=>e.type==='trial_completed'); const passed=completed.filter(e=>e.data?.trial?.success).length;
  const active=related.filter(e=>e.type==='trial_started').length-completed.length;
  clear(byId('live'),node('div',{class:'grid'},[
    ...[['Run',state.activeRun||'无'],['已完成',completed.length],['通过',passed],['进行中',Math.max(0,active)]].map(([k,v])=>node('article',{class:'card third'},[node('div',{class:'muted',text:k}),node('div',{class:'metric',text:v})])),
    node('article',{class:'card full'},[node('div',{class:'row'},[node('h2',{text:'实时轨迹'}),button('取消当前 Run',safely(async()=>{if(state.activeRun)await api.cancelRun(state.activeRun);renderLive();}),'danger')]),node('div',{},related.slice(-100).reverse().map(e=>node('div',{class:`event ${e.data?.trial?.success?'pass':e.type==='run_failed'?'fail':''}`},[node('strong',{text:e.type}),node('span',{class:'muted',text:` ${e.timestamp||''}`}),node('pre',{text:JSON.stringify(e.data,null,2)})])))])
  ]));
}

async function loadHistory(){ state.runs=await api.listRuns(); renderHistory(); }
function renderHistory(){
  const rows=state.runs.map(run=>node('tr',{},[node('td',{text:run.id}),node('td',{},[node('span',{class:`status ${run.status==='completed'?'ok':run.status==='corrupt'?'bad':'warn'}`,text:run.status})]),node('td',{text:run.metadata?.trial_count??'N/A'}),node('td',{},[button('查看',safely(async()=>{state.selectedRun=await api.getRun(run.id);show('report');renderReport();}))]) ]));
  clear(byId('history'),node('article',{class:'card full'},[node('h2',{text:'运行历史'}),node('p',{class:'muted',text:'从规范 artifacts 重建；会区分 completed、interrupted、cancelled、corrupt 和不支持的 schema。'}),node('table',{class:'table'},[node('thead',{},[node('tr',{},['Run ID','状态','Trials','操作'].map(v=>node('th',{text:v})))]),node('tbody',{},rows)])]));
}

function runTaskMap(run){return new Map((run?.trials||[]).map(t=>[`${t.task.id}/${t.agent}/${t.replicate}`,t]));}
async function compareSelected(){const a=byId('baseline').value,b=byId('candidate').value;if(!a||!b)return;const [left,right]=await Promise.all([api.getRun(a),api.getRun(b)]);const lm=runTaskMap(left),rm=runTaskMap(right);const common=[...lm.keys()].filter(k=>rm.has(k));const regressions=common.filter(k=>lm.get(k).success&&!rm.get(k).success);const target=byId('comparison');clear(target,json({common_eligible_trials:common.length,regressions,coverage_delta:(right.trials?.length||0)-(left.trials?.length||0)}));}
function renderReport(){
  const run=state.selectedRun; const ids=state.runs.map(r=>r.id); const baseline=node('select',{id:'baseline'}),candidate=node('select',{id:'candidate'}); for(const id of ids){baseline.append(node('option',{value:id,text:id}));candidate.append(node('option',{value:id,text:id}));}
  if(ids[1])baseline.value=ids[1];if(ids[0])candidate.value=ids[0];
  const trials=run?.trials||[];
  const rows=trials.map(t=>node('tr',{},[node('td',{text:t.task.id}),node('td',{text:t.task.quality_tier||'experimental'}),node('td',{text:t.status}),node('td',{text:t.failure_category||'—'}),node('td',{text:t.metrics?.telemetry_level||'L0'}),node('td',{text:t.metrics?.duration_ms??'N/A'})]));
  clear(byId('report'),node('div',{class:'grid'},[
    node('article',{class:'card full'},[node('div',{class:'row'},[node('h2',{text:'Run 报告'}),run?button('导出脱敏 JSON',safely(()=>api.exportRun(run.metadata?.run_id||run.id,'json'))):text(''),run?button('导出可读报告',safely(()=>api.exportRun(run.metadata?.run_id||run.id,'markdown'))):text('')]),run?node('div',{class:'stack'},[json({metadata:run.metadata,summary:run.summary}),node('table',{class:'table'},[node('thead',{},[node('tr',{},['任务','质量层','结果','失败归因','遥测','耗时'].map(v=>node('th',{text:v})))]),node('tbody',{},rows)]),node('details',{},[node('summary',{text:'完整规范 artifacts（含 grader、分母、provenance）'}),json(run)])]):node('p',{class:'muted',text:'从历史中选择一个 Run 查看。'})]),
    node('article',{class:'card full'},[node('h2',{text:'覆盖感知对比'}),node('div',{class:'row'},[field('基线',baseline),field('候选',candidate),button('比较共同 eligible 交集',safely(compareSelected),'primary')]),node('div',{id:'comparison',class:'muted',text:'对比不会把 NOT_APPLICABLE 当失败，并单列覆盖率变化。'})])
  ]));
}

api.onEvent((event)=>{state.events.push(event);const id=eventRunId(event);if(!state.activeRun&&id)state.activeRun=id;if(byId('live')&&!byId('live').hidden)renderLive();if(event.type==='run_completed'||event.type==='run_failed')loadHistory();});

renderTabs();renderSource();renderConfigure();renderLive();renderHistory();renderReport();
safely(async()=>{const result=await api.doctor();const target=byId('doctor');target.textContent=result.ready?'环境就绪':'环境需处理';target.className=`pill ${result.ready?'ok':'warn'}`;target.title=(result.checks||[]).map(c=>c.message).join('\n');})();
