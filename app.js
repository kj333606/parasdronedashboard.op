const ADMIN_USER="admin", ADMIN_PASS="drone@321";
const DEFAULT_TITLE="Paras Antidrone";
const DEFAULT_DRONES=[
 {id:"DJI-01",name:"DJI Mavic 3 Pro",category:"DJI Drone"},
 {id:"DJI-02",name:"DJI Mini 4 Pro",category:"DJI Drone"},
 {id:"DJI-03",name:"DJI Matrice 30T",category:"DJI Drone"},
 {id:"CUS-01",name:"Custom Heavy-Lift Hexacopter",category:"Custom Drone"},
 {id:"CUS-02",name:"Custom FPV Racer",category:"Custom Drone"},
 {id:"RNT-01",name:"Rental Quadcopter A",category:"Rental Drone"},
 {id:"RNT-02",name:"Rental Quadcopter B",category:"Rental Drone"}
];
const DEFAULT_PILOTS=[
 {id:"PL-01",name:"Rahul Naik"},
 {id:"PL-02",name:"Priya Desai"},
 {id:"PL-03",name:"Vikram Shetty"},
 {id:"PL-04",name:"Sneha Kamat"},
 {id:"PL-05",name:"Aditya Pai"}
];

// Live lists, replaced by the admin's saved settings when they load
let TITLE=DEFAULT_TITLE, DRONES=DEFAULT_DRONES, PILOTS=DEFAULT_PILOTS;

const S={user:null,view:"home",reqs:[],ready:false,dbErr:"",toast:"",msg:"",busy:false,filter:"pending",
 loginTab:"user",loginErr:"",login:{empId:"",empName:"",user:"",pass:""},d:{step:0},p:{step:0},
 edit:null,nd:{name:"",category:"",vendor:""},np:{name:""},statusMap:{drones:{},pilots:{}},sd:{},rep:{drone:"",month:""}};
let db=null, downloads=null;

// ---- helpers ----
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad=n=>String(n).padStart(2,"0");
const today=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
const addDays=(s,n)=>{const[y,m,d]=s.split("-").map(Number);return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10)};
const spanDays=(a,b)=>Math.round((Date.parse(b)-Date.parse(a))/864e5)+1;
const pill=(t,c)=>`<span class="pill ${c}">${esc(t)}</span>`;
const statusPill=s=>s==="approved"?pill("Approved","ok"):s==="rejected"?pill("Rejected","bad"):pill("Pending","warn");
const cats=()=>[...new Set(DRONES.map(d=>d.category).filter(Boolean))];
const newId=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,5).toUpperCase();
const approved=t=>S.reqs.filter(r=>r.type===t&&r.status==="approved");
function manualDrone(id){const m=S.statusMap.drones?.[id];return m&&m.state?m:null}
function manualPilot(id){const m=S.statusMap.pilots?.[id];return m&&m.state?m:null}
function decidedAt(r){return r.decidedAt||r.createdAt||0}
function droneInfo(id){
  const m=manualDrone(id);
  if(m&&m.state==="maintenance") return {state:"maintenance",label:"Under maintenance",reason:m.reason||"Under maintenance"};
  if(m&&m.state==="unavailable") return {state:"unavailable",label:"Not available",reason:m.reason||"Marked unavailable by admin"};
  const t=today(), since=m&&m.state==="available"?m.at||0:0;
  const b=S.reqs.find(r=>r.type==="drone"&&r.status==="approved"&&r.droneId===id&&r.handoverDate>=t&&r.ret!=="returned"&&decidedAt(r)>since);
  if(b) return {state:"booked",label:"Not available in office",
    reason:`Booked by ${b.empName} (${b.empId}), ${b.requiredDate} to ${b.handoverDate}. Reason: ${b.reason}`};
  return {state:"available",label:"In stock",reason:""};
}
const droneOut=id=>droneInfo(id).state!=="available";
function droneBadge(id){
  const i=droneInfo(id);
  return i.state==="available"?pill("In stock","ok"):pill(i.label,"bad");
}
function pilotInfo(id){
  const m=manualPilot(id);
  if(m&&m.state==="unavailable") return {out:true,label:"Not available",reason:m.reason||"Marked unavailable by admin",leave:false};
  const since=m&&m.state==="available"?m.at||0:0;
  const st=pilotState(id,since);
  if(st) return {out:true,label:"Not available",reason:pilotStatusText(st),leave:st.type==="leave"};
  return {out:false,label:"Available",reason:"",leave:false};
}
const pilotOut=id=>pilotInfo(id).out;
const pendingCount=()=>S.reqs.filter(r=>r.status==="pending"||(r.type==="drone"&&r.ret==="requested")).length;
const isPilotType=t=>t==="pilot"||t==="leave";
function conflict(r){
  return S.reqs.some(x=>x.id!==r.id&&x.status==="approved"&&(
    r.type==="drone"
      ? x.type==="drone"&&x.droneId===r.droneId&&x.requiredDate<=r.handoverDate&&x.handoverDate>=r.requiredDate
      : isPilotType(x.type)&&x.pilotId===r.pilotId&&x.startDate<=r.endDate&&x.endDate>=r.startDate));
}
function pilotState(id,since=0){
  const t=today();
  return S.reqs.find(r=>isPilotType(r.type)&&r.status==="approved"&&r.pilotId===id&&r.endDate>=t&&decidedAt(r)>since)||null;
}
function pilotStatusText(st){
  const dt=st.startDate===st.endDate?st.startDate:`${st.startDate} to ${st.endDate}`;
  if(st.type==="pilot") return `On outdoor duty at ${st.location||"site"} (${dt}, ${st.days} day${st.days>1?"s":""}). Reason: ${st.reason}`;
  if(st.leaveKind==="half") return `Leave: half day (${st.session||"Morning"}) on ${st.startDate}. Reason: ${st.reason}`;
  const n=spanDays(st.startDate,st.endDate);
  return `Leave: ${dt}, ${n} day${n>1?"s":""}. Reason: ${st.reason}`;
}
function resetD(){S.d={step:0,empId:S.user?.empId||"",empName:S.user?.empName||"",requiredDate:"",handoverDate:"",reason:""}}
function resetP(){S.p={step:0,empId:S.user?.empId||"",empName:S.user?.empName||"",startDate:"",days:"",location:"",reason:""}}
function resetL(){S.l={kind:"full",from:"",to:"",date:"",session:"Morning",reason:""}}
function field(scope,k,label,type="text",extra=""){
  return `<label>${label}<input type="${type}" data-scope="${scope}" data-k="${k}" value="${esc(S[scope][k]??"")}" ${extra}></label>`;
}
function area(scope,k,label){
  return `<label>${label}<textarea data-scope="${scope}" data-k="${k}" rows="3">${esc(S[scope][k]??"")}</textarea></label>`;
}

// ---- views ----

function loginView(){
  const T=S.loginTab;
  const tabBtn=(v,t)=>`<button class="tab ${T===v?"on":""}" data-act="ltab" data-v="${v}">${t}</button>`;
  let form;
  if(T==="user") form=`${field("login","empId","Employee ID")}${field("login","empName","Full name")}
     <button class="btn full" data-act="login-user">Enter Dashboard</button>
     <p class="muted" style="margin-top:10px">No sign-up needed. Enter your employee ID and name.</p>`;
  else if(T==="pilot") form=`${field("login","user","Pilot name")}${field("login","pass","Password","password")}
     <button class="btn full" data-act="login-pilot">Pilot Sign In</button>`;
  else form=`${field("login","user","Username")}${field("login","pass","Password","password")}
     <button class="btn full" data-act="login-admin">Admin Sign In</button>`;
  return `<div class="login"><div class="card login-card">
    <div class="brand"><img src="assets/logo.jpg" alt="Logo"><h1>${esc(TITLE)}</h1></div><p class="muted">Drone and pilot management dashboard</p>
    <div class="tabs" style="margin-top:12px">${tabBtn("user","User Login")}${tabBtn("pilot","Pilot Login")}${tabBtn("admin","Admin Login")}</div>
    ${form}
    ${S.loginErr?`<p class="err">${esc(S.loginErr)}</p>`:""}
  </div>${festivalView()}</div>`;
}

function pilotRows(){
  return PILOTS.map(p=>{
    const i=pilotInfo(p.id);
    const mine=S.user?.role==="pilot"&&S.user.pilotId===p.id;
    return `<div class="row" style="flex-direction:column;align-items:stretch">
      <div class="row" style="border:0;padding:0"><span><b>${esc(p.name)}</b> <span class="muted">${esc(p.id)}</span></span>
      ${i.out?pill("Not available","bad"):pill("Available","ok")}</div>
      ${i.out?`<div class="muted">${esc(i.reason)}</div>`:""}
      ${mine&&i.leave?`<div class="actions"><button class="btn sm ok" data-act="pilot-back" data-id="${p.id}">I am back: set me Available</button></div>`:""}
    </div>`;
  }).join("") || `<p class="muted">No pilots listed yet.</p>`;
}
function home(){
  const total=DRONES.length, out=DRONES.filter(d=>droneOut(d.id)).length;
  const catCards=cats().map(c=>{
    const list=DRONES.filter(d=>d.category===c), inS=list.filter(d=>!droneOut(d.id)).length;
    return `<div class="card cat"><h3>${esc(c)}</h3>
      <div class="big">${inS}<small> / ${list.length} in stock</small></div>
      <ul>${list.map(d=>{const i=droneInfo(d.id);return `<li><span>${esc(d.name)}</span>${droneBadge(d.id)}</li>${i.state!=="available"?`<li class="muted" style="border:0;padding-top:0">${esc(i.reason)}</li>`:""}`}).join("")}</ul></div>`;
  }).join("");
  return `
    <section class="card hero">
      <div><div class="muted">Drones in stock</div><div class="huge">${total-out}</div></div>
      <div class="muted">of ${total} total &middot; ${out} not available</div>
    </section>
    <div class="grid3">${catCards}</div>
    <section class="card"><h3>Drone Pilots</h3>${pilotRows()}
      ${S.user.role==="user"?`<div class="actions"><button class="btn" data-act="go" data-v="pilot">Request Pilot</button></div>`:""}
    </section>`;
}

function droneReq(){
  const d=S.d;
  if(d.step===0){
    return `<section class="card"><h3>Step 1 &middot; Choose a drone</h3>
      <div class="grid2">${DRONES.map(x=>`<div class="card item">
        <b>${esc(x.name)}</b><span class="muted">${esc(x.id)} &middot; ${esc(x.category)}</span>
        ${droneBadge(x.id)}
        <div class="actions"><button class="btn sm" data-act="pick-drone" data-id="${x.id}">Select</button></div></div>`).join("")}
      </div></section>`;
  }
  const sel=DRONES.find(x=>x.id===d.droneId);
  if(!sel){S.d={step:0};return droneReq();}
  const head=`<p class="note">Selected: <b>${esc(sel.name)}</b> (${esc(sel.id)})</p>`;
  const err=S.msg?`<p class="err">${esc(S.msg)}</p>`:"";
  if(d.step===1){
    return `<section class="card"><h3>Step 2 &middot; Your details and dates</h3>${head}
      ${field("d","empId","Employee ID")}${field("d","empName","Employee name")}
      ${field("d","requiredDate","Drone required date","date",`min="${today()}"`)}
      ${field("d","handoverDate","Handover date","date",`min="${today()}"`)}
      ${err}
      <div class="actions"><button class="btn sec" data-act="d-back">Back</button><button class="btn" data-act="d-next">Next</button></div></section>`;
  }
  return `<section class="card"><h3>Step 3 &middot; Reason</h3>${head}
    <p class="muted">Dates: ${esc(d.requiredDate)} to ${esc(d.handoverDate)}</p>
    ${area("d","reason","Why do you need this drone?")}
    ${err}
    <div class="actions"><button class="btn sec" data-act="d-back">Back</button>
    <button class="btn ok" data-act="d-submit" ${S.busy?"disabled":""}>Submit Request</button></div></section>`;
}

function pilotReq(){
  const p=S.p;
  if(p.step===0){
    const avail=PILOTS.filter(x=>!pilotOut(x.id));
    return `<section class="card"><h3>Choose an available pilot</h3>
      ${avail.length?avail.map(x=>`<div class="row"><span><b>${esc(x.name)}</b> <span class="muted">${esc(x.id)}</span></span>
        <button class="btn sm" data-act="pick-pilot" data-id="${x.id}">Select</button></div>`).join("")
        :`<p class="muted">All pilots are currently on outdoor duty.</p>`}
      <div class="actions"><button class="btn sec" data-act="go" data-v="home">Cancel</button></div></section>`;
  }
  const sel=PILOTS.find(x=>x.id===p.pilotId);
  if(!sel){S.p={step:0};return pilotReq();}
  return `<section class="card"><h3>Pilot request &middot; ${esc(sel.name)}</h3>
    ${field("p","empId","Your Employee ID")}${field("p","empName","Your name")}
    ${field("p","startDate","Pilot required date","date",`min="${today()}"`)}
    ${field("p","days","Number of days","number",`min="1" step="1"`)}
    ${field("p","location","Location / site where pilot is needed")}
    ${area("p","reason","Reason for pilot requirement")}
    ${S.msg?`<p class="err">${esc(S.msg)}</p>`:""}
    <div class="actions"><button class="btn sec" data-act="p-back">Back</button>
    <button class="btn ok" data-act="p-submit" ${S.busy?"disabled":""}>Send to Admin</button></div></section>`;
}

function reqCard(r,withActions){
  const isD=r.type==="drone", isL=r.type==="leave";
  const title=isD?`Drone: ${r.droneName} (${r.droneId})`:isL?`Leave: ${r.pilotName} (${r.pilotId})`:`Pilot: ${r.pilotName} (${r.pilotId})`;
  const dates=isD?`${r.requiredDate} to ${r.handoverDate}`
    :isL?(r.leaveKind==="half"?`${r.startDate} · Half day (${r.session})`:`${r.startDate} to ${r.endDate} (${r.days} day${r.days>1?"s":""})`)
    :`${r.startDate} to ${r.endDate} (${r.days} day${r.days>1?"s":""})`;
  const loc=r.type==="pilot"?`<div>Location: ${esc(r.location)}</div>`:"";
  const who=isD?"drone":"pilot";
  const warn=r.status==="pending"&&conflict(r)?`<p class="err">Overlaps an approved booking for this ${who}.</p>`:"";
  let acts="";
  if(withActions&&r.status==="pending")
    acts=`<div class="actions"><button class="btn ok" data-act="decide" data-id="${r.id}" data-v="approved">Approve</button>
       <button class="btn bad" data-act="decide" data-id="${r.id}" data-v="rejected">Reject</button></div>`;
  if(withActions&&isD&&r.status==="approved"&&r.ret==="requested")
    acts=`<div class="actions"><button class="btn ok" data-act="ret-accept" data-id="${r.id}">Accept return</button>
       <button class="btn bad" data-act="ret-reject" data-id="${r.id}">Not received</button></div>`;
  const retLine=isD&&r.status==="approved"?`<div>Status: ${esc(retLabel(r))}${r.ret==="returned"?` on ${esc(r.returnedDate)}`:""}</div>`:"";
  return `<div class="card item"><div class="row"><b>${esc(title)}</b>${statusPill(r.status)}</div>
    <div>Requested by: ${esc(r.empName)} (${esc(r.empId)})</div><div>${esc(dates)}</div>${loc}${retLine}
    <div class="muted">Reason: ${esc(r.reason)}</div>${warn}${acts}</div>`;
}

function mineView(){
  const mine=S.reqs.filter(r=>r.empId===S.user.empId).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  return `<section class="card"><h3>My Requests</h3>${mine.length?mine.map(r=>reqCard(r,false)).join(""):'<p class="muted">You have not made any requests yet.</p>'}</section>`;
}

function leaveView(){
  const l=S.l;
  return `<section class="card"><h3>Apply for leave or half day</h3>
    <label>Type<select data-scope="l" data-k="kind">
      <option value="full" ${l.kind!=="half"?"selected":""}>Leave (from and to dates)</option>
      <option value="half" ${l.kind==="half"?"selected":""}>Half day</option></select></label>
    ${l.kind==="half"
      ? `${field("l","date","Date","date",`min="${today()}"`)}
         <label>Session<select data-scope="l" data-k="session">
           <option ${l.session!=="Afternoon"?"selected":""}>Morning</option>
           <option ${l.session==="Afternoon"?"selected":""}>Afternoon</option></select></label>`
      : `${field("l","from","From date","date",`min="${today()}"`)}${field("l","to","To date","date",`min="${today()}"`)}`}
    ${area("l","reason","Reason for leave")}
    ${S.msg?`<p class="err">${esc(S.msg)}</p>`:""}
    <div class="actions"><button class="btn ok" data-act="l-submit" ${S.busy?"disabled":""}>Send to Admin</button></div></section>`;
}
function inventoryView(){
  const total=DRONES.length, out=DRONES.filter(d=>droneOut(d.id)).length;
  const rows=DRONES.map(d=>{const i=droneInfo(d.id);return `<div class="row" style="flex-direction:column;align-items:stretch">
    <div class="row" style="border:0;padding:0"><span><b>${esc(d.name)}</b> <span class="muted">${esc(d.id)} &middot; ${esc(d.category)}</span></span>${droneBadge(d.id)}</div>
    ${i.state!=="available"?`<div class="muted">${esc(i.reason)}</div>`:""}</div>`;}).join("")
    || `<p class="muted">No drones listed.</p>`;
  return `<section class="card"><h3>Drone inventory</h3>
    <p class="muted">In stock: <b>${total-out}</b> of ${total}</p>${rows}</section>
    <section class="card"><h3>Pilot status</h3>${pilotRows()}</section>`;
}
function statusView(){
  const dState=(id)=>{const m=S.statusMap.drones?.[id]||{},d=S.sd["drone:"+id]||{};return {state:d.state??m.state??"available",reason:d.reason??m.reason??""};};
  const pState=(id)=>{const m=S.statusMap.pilots?.[id]||{},d=S.sd["pilot:"+id]||{};return {state:d.state??m.state??"available",reason:d.reason??m.reason??""};};
  const dOpts=sel=>[["available","Available"],["unavailable","Not available"],["maintenance","Under maintenance"]]
    .map(([v,t])=>`<option value="${v}" ${sel===v?"selected":""}>${t}</option>`).join("");
  const pOpts=sel=>[["available","Available"],["unavailable","Not available"]]
    .map(([v,t])=>`<option value="${v}" ${sel===v?"selected":""}>${t}</option>`).join("");
  return `<section class="card"><h3>Drone status</h3>
    <p class="muted">Set a drone to Not available or Under maintenance with a reason. It shows on the dashboard for everyone.</p>
    ${DRONES.map(d=>{const s=dState(d.id);return `<div class="row edit">
      <span style="min-width:180px"><b>${esc(d.name)}</b> <span class="muted">${esc(d.id)}</span><br><span class="muted">Vendor: ${esc(d.vendor||"-")}</span></span>
      <select data-sk="drone:${esc(d.id)}" data-sf="state">${dOpts(s.state)}</select>
      <input data-sk="drone:${esc(d.id)}" data-sf="reason" value="${esc(s.reason)}" placeholder="Reason">
      <button class="btn sm" data-act="set-status" data-kind="drone" data-id="${esc(d.id)}">Save</button></div>`;}).join("")
      || `<p class="muted">No drones. Add them in Settings.</p>`}
  </section>
  <section class="card"><h3>Pilot status</h3>
    <p class="muted">Set a pilot to Not available with a reason, or back to Available.</p>
    ${PILOTS.map(p=>{const s=pState(p.id);return `<div class="row edit">
      <span style="min-width:180px"><b>${esc(p.name)}</b> <span class="muted">${esc(p.id)}</span></span>
      <select data-sk="pilot:${esc(p.id)}" data-sf="state">${pOpts(s.state)}</select>
      <input data-sk="pilot:${esc(p.id)}" data-sf="reason" value="${esc(s.reason)}" placeholder="Reason">
      <button class="btn sm" data-act="set-status" data-kind="pilot" data-id="${esc(p.id)}">Save</button></div>`;}).join("")
      || `<p class="muted">No pilots. Add them in Settings.</p>`}
  </section>`;
}
function approvalsView(){
  const f=S.filter;
  const isRet=r=>r.type==="drone"&&r.ret==="requested";
  const list=S.reqs.filter(r=>f==="all"?true:f==="return"?isRet(r):f==="pending"?(r.status==="pending"||isRet(r)):r.status===f)
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const tabs=[["pending","Pending"],["approved","Approved"],["rejected","Rejected"],["return","Returns"],["all","All"]]
    .map(([x,t])=>`<button class="tab ${f===x?"on":""}" data-act="filter" data-v="${x}">${t}</button>`).join("");
  return `<section class="card"><h3>Requests</h3><div class="tabs">${tabs}</div>
    ${list.length?list.map(r=>reqCard(r,true)).join(""):'<p class="muted">No requests here.</p>'}</section>`;
}

function settingsView(){
  const E=S.edit||{title:TITLE,drones:DRONES,pilots:PILOTS};
  return `
  <section class="card"><h3>Dashboard name</h3>
    <input class="wide" data-edit="title" value="${esc(E.title)}">
  </section>
  <section class="card"><h3>Drone list</h3>
    <p class="muted">Edit names or categories directly. Categories become the cards on the home page.</p>
    ${E.drones.map((d,i)=>`<div class="row edit">
      <span class="muted" style="min-width:70px">${esc(d.id)}</span>
      <input data-edit="drone" data-i="${i}" data-f="name" value="${esc(d.name)}" placeholder="Drone name">
      <input data-edit="drone" data-i="${i}" data-f="category" value="${esc(d.category)}" placeholder="Category">
      <input data-edit="drone" data-i="${i}" data-f="vendor" value="${esc(d.vendor||"")}" placeholder="Vendor (rental)">
      <button class="btn bad sm" data-act="rm" data-kind="drones" data-i="${i}">Remove</button></div>`).join("")
      || `<p class="muted">No drones. Add one below.</p>`}
    <h4>Add a drone</h4>
    <div class="row edit">
      <input data-scope="nd" data-k="name" value="${esc(S.nd.name)}" placeholder="Drone name">
      <input data-scope="nd" data-k="category" value="${esc(S.nd.category)}" placeholder="Category (e.g. DJI Drone)">
      <input data-scope="nd" data-k="vendor" value="${esc(S.nd.vendor)}" placeholder="Vendor (rental drones)">
      <button class="btn sm" data-act="add-drone">Add drone</button></div>
  </section>
  <section class="card"><h3>Pilot list</h3>
    ${E.pilots.map((p,i)=>`<div class="row edit">
      <span class="muted" style="min-width:70px">${esc(p.id)}</span>
      <input data-edit="pilot" data-i="${i}" data-f="name" value="${esc(p.name)}" placeholder="Pilot name">
      <button class="btn bad sm" data-act="rm" data-kind="pilots" data-i="${i}">Remove</button></div>`).join("")
      || `<p class="muted">No pilots. Add one below.</p>`}
    <h4>Add a pilot</h4>
    <div class="row edit">
      <input data-scope="np" data-k="name" value="${esc(S.np.name)}" placeholder="Pilot name">
      <button class="btn sm" data-act="add-pilot">Add pilot</button></div>
  </section>
  <div class="actions">
    <button class="btn sec" data-act="reset-edit">Discard changes</button>
    <button class="btn ok" data-act="save-cfg" ${S.busy?"disabled":""}>Save all settings</button>
  </div>`;
}

function reportsView(){
  const d=DRONES.find(x=>x.id===S.rep.drone), m=S.rep.month||"";
  const dOpts=`<option value="">Select a drone</option>`+DRONES.map(x=>
    `<option value="${esc(x.id)}" ${S.rep.drone===x.id?"selected":""}>${esc(x.name)} (${esc(x.id)}) · Vendor: ${esc(x.vendor||"-")}</option>`).join("");
  const mOpts=`<option value="" ${m===""?"selected":""}>All months</option>`+monthList(18).map(x=>
    `<option value="${x}" ${m===x?"selected":""}>${esc(monthLabel(x))}</option>`).join("");
  let preview=`<p class="muted">Select a drone to see its usage.</p>`;
  if(d){
    let total=0;
    const body=droneRows(d.id,m).map((r,i)=>{const days=spanDays(r.requiredDate,r.handoverDate);total+=days;
      return `<tr>${[i+1,r.handoverDate,r.empName,r.empId,r.reason,days].map(v=>`<td style="border-bottom:1px solid var(--line);padding:6px">${esc(v)}</td>`).join("")}</tr>`;}).join("")
      || `<tr><td colspan="6" class="muted" style="padding:8px">No usage for this period.</td></tr>`;
    preview=`<div style="margin-top:12px;overflow-x:auto">
      <p style="margin:0 0 4px"><b>Vendor:</b> ${esc(d.vendor||"-")}</p>
      <p style="margin:0 0 4px"><b>Drone:</b> ${esc(d.name)} (${esc(d.id)})</p>
      <p style="margin:0 0 10px"><b>Month &amp; Year:</b> ${esc(m?monthLabel(m):"All months")}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr>${["Sr. No","Handover Date","User Name","Employee ID","Purpose of Use","No. of Days"].map(h=>`<th style="text-align:left;border-bottom:1px solid var(--line);padding:6px">${h}</th>`).join("")}</tr>
      ${body}
      <tr><td colspan="5" style="padding:6px;text-align:right"><b>Total Days</b></td><td style="padding:6px"><b>${total}</b></td></tr>
      </table></div>`;
  }
  const items=[
    ["stock","Drone Stock Report","Each drone with its category, status today, and total approved bookings and days."],
    ["users","Who Used Which Drone","Approved drone bookings with employee ID, name, dates and reason."],
    ["pilots","Pilot Movement Report","Approved pilot assignments: which pilot went where, when, for how many days, and why."]
  ];
  return `<section class="card"><h3>Monthly drone usage report</h3>
    <p class="muted">Choose a drone (with its vendor) and a month, then download that drone's report.</p>
    <label>Drone<select data-scope="rep" data-k="drone" style="width:100%;padding:9px;font-size:15px">${dOpts}</select></label>
    <label>Month<select data-scope="rep" data-k="month" style="width:100%;padding:9px;font-size:15px">${mOpts}</select></label>
    ${preview}
    <div class="actions"><button class="btn" data-act="drone-report" ${d?"":"disabled"}>Download this report</button></div>
  </section>
  <section class="card"><h3>Other reports (CSV)</h3>
    ${items.map(([k,t,desc])=>`<div class="row"><div><b>${esc(t)}</b><div class="muted">${esc(desc)}</div></div>
      <button class="btn" data-act="report" data-v="${k}">Download</button></div>`).join("")}
  </section>`;
}

function usageRows(id){
  return S.reqs.filter(r=>r.type==="drone"&&r.droneId===id&&r.status==="approved")
    .sort((a,b)=>a.requiredDate.localeCompare(b.requiredDate));
}
function retLabel(r){return r.ret==="returned"?"Returned":r.ret==="requested"?"Return requested":"With user";}
function toCsv(rows){return rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n")}
function droneCSV(id){
  const d=DRONES.find(x=>x.id===id); if(!d) return null;
  const rows=[["DRONE REPORT"],["Vendor",d.vendor||"-"],["Drone Name",d.name],["Drone ID",d.id],["Category",d.category],[],
    ["Employee ID","Employee Name","Taken Date","Returned Date","Days Held","Reason","Return Status"]];
  usageRows(id).forEach(r=>{
    const back=r.ret==="returned";
    rows.push([r.empId,r.empName,r.requiredDate,back?r.returnedDate:"Not returned",
      back?spanDays(r.requiredDate,r.returnedDate):"",r.reason,retLabel(r)]);
  });
  return {name:`drone-${d.id}-report.csv`,csv:toCsv(rows)};
}
function driveView(){
  const mine=S.reqs.filter(r=>r.type==="drone"&&r.status==="approved"&&r.empId===S.user.empId);
  const out=mine.filter(r=>r.ret!=="returned").sort((a,b)=>a.requiredDate.localeCompare(b.requiredDate));
  const done=mine.filter(r=>r.ret==="returned").sort((a,b)=>(b.returnedAt||0)-(a.returnedAt||0));
  const card=r=>`<div class="card item"><div class="row"><b>${esc(r.droneName)} (${esc(r.droneId)})</b>${pill("With you","warn")}</div>
    <div>Taken on: ${esc(r.requiredDate)} &middot; Due back: ${esc(r.handoverDate)}</div>
    <div class="muted">Reason: ${esc(r.reason)}</div>
    ${r.ret==="requested"?`<p class="muted">Return requested. Waiting for admin to accept.</p>`
      :`<div class="actions"><button class="btn" data-act="ret-request" data-id="${r.id}">Return drone</button></div>`}</div>`;
  return `<section class="card"><h3>Drones with you</h3>
    ${out.length?out.map(card).join(""):'<p class="muted">You have no drones checked out.</p>'}</section>
    <section class="card"><h3>Returned drones</h3>
    ${done.length?done.map(r=>`<div class="row"><span><b>${esc(r.droneName)}</b> &middot; taken ${esc(r.requiredDate)} &middot; returned ${esc(r.returnedDate)}</span>${pill("Returned","ok")}</div>`).join(""):'<p class="muted">No returns yet.</p>'}</section>`;
}
function monthRange(m){
  const[y,mo]=m.split("-").map(Number);
  const s=`${y}-${pad(mo)}-01`, nx=new Date(Date.UTC(y,mo,1)).toISOString().slice(0,10);
  return [s,addDays(nx,-1)];
}
function monthLabel(m){
  const[y,mo]=m.split("-").map(Number);
  return new Date(Date.UTC(y,mo-1,1)).toLocaleDateString("en-US",{month:"long",year:"numeric",timeZone:"UTC"});
}
function monthList(n){
  const d=new Date(), out=[];
  for(let i=0;i<n;i++){const x=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-i,1));out.push(x.toISOString().slice(0,7));}
  return out;
}
function droneRows(id,m){
  let list=usageRows(id);
  if(m){const [s,e]=monthRange(m);list=list.filter(r=>r.handoverDate>=s&&r.requiredDate<=e);}
  return list;
}
function droneReport(id,m){
  const d=DRONES.find(x=>x.id===id); if(!d) return null;
  const rows=[["Vendor",d.vendor||"-"],["Drone Name",`${d.name} (${d.id})`],["Month & Year",m?monthLabel(m):"All months"],[],
    ["Sr. No","Handover Date","User Name","Employee ID","Purpose of Use","No. of Days"]];
  let total=0;
  droneRows(id,m).forEach((r,i)=>{const days=spanDays(r.requiredDate,r.handoverDate);total+=days;
    rows.push([i+1,r.handoverDate,r.empName,r.empId,r.reason,days]);});
  rows.push([]); rows.push(["","","","","Total Days",total]);
  return {name:`drone-${d.id}-${m||"all-months"}-report.csv`,csv:toCsv(rows)};
}
async function writeStatus(bucket,id,entry){
  const next={drones:{...S.statusMap.drones},pilots:{...S.statusMap.pilots}};
  if(entry) next[bucket][id]=entry; else delete next[bucket][id];
  await db.collection("config").doc("status").set(next);
}
const FESTIVALS=[
 {name:"Navratri",date:"2026-10-11",end:"2026-10-19",msg:"Happy Navratri! May Maa Durga bless you with strength and success.",art:"lamp"},
 {name:"Dussehra",date:"2026-10-20",msg:"Happy Dussehra! May good always triumph over evil.",art:"lamp"},
 {name:"Diwali",date:"2026-11-08",msg:"Happy Diwali! Wishing you light, joy and prosperity.",art:"lamp"},
 {name:"Christmas",date:"2026-12-25",msg:"Merry Christmas! Wishing you peace and happiness.",art:"tree"},
 {name:"New Year",date:"2027-01-01",msg:"Happy New Year 2027! Wishing you a safe and successful year.",art:"star"}
];
const FEST_ART={
 lamp:`<svg viewBox="0 0 160 120" xmlns="http://www.w3.org/2000/svg"><ellipse cx="80" cy="60" rx="46" ry="30" fill="#fde68a" opacity=".35"/><ellipse cx="80" cy="88" rx="58" ry="14" fill="#b45309"/><path d="M28 84 Q80 118 132 84 Z" fill="#d97706"/><path d="M80 22 Q94 46 80 66 Q66 46 80 22Z" fill="#fb923c"/><path d="M80 34 Q86 50 80 62 Q74 50 80 34Z" fill="#fef08a"/></svg>`,
 tree:`<svg viewBox="0 0 160 120" xmlns="http://www.w3.org/2000/svg"><rect x="72" y="92" width="16" height="16" fill="#92400e"/><path d="M80 10 L118 52 L100 52 L130 90 L30 90 L60 52 L42 52 Z" fill="#16a34a"/><polygon points="80,4 84,14 95,14 86,20 90,31 80,25 70,31 74,20 65,14 76,14" fill="#fde047"/><circle cx="96" cy="70" r="4" fill="#ef4444"/><circle cx="66" cy="78" r="4" fill="#3b82f6"/></svg>`,
 star:`<svg viewBox="0 0 160 120" xmlns="http://www.w3.org/2000/svg"><polygon points="80,8 92,44 130,44 100,66 111,102 80,80 49,102 60,66 30,44 68,44" fill="#facc15"/><path d="M20 30 L30 20 M140 30 L130 20 M80 110 L80 118" stroke="#f472b6" stroke-width="4" stroke-linecap="round"/><circle cx="20" cy="90" r="3" fill="#60a5fa"/><circle cx="140" cy="90" r="3" fill="#34d399"/></svg>`
};
function activeFestival(){
  const t=today();
  return FESTIVALS.find(f=>t>=addDays(f.date,-7)&&t<=addDays(f.end||f.date,1))||null;
}
function festivalView(){
  const f=activeFestival(); if(!f) return "";
  const sparks=Array.from({length:14},(_,i)=>`<span class="spark" style="left:${(i*7.3)%100}%;animation-duration:${3+(i%5)}s;animation-delay:${i*0.35}s;background:${["#f59e0b","#ef4444","#22c55e","#3b82f6"][i%4]}"></span>`).join("");
  return `<div class="fest">${sparks}${FEST_ART[f.art]}<h2>${esc(f.name)}</h2><p>${esc(f.msg)}</p><span class="muted">${esc(f.date)}</span></div>`;
}
function reportCSV(kind){
  const A=approved("drone"), rows=[]; let name="";
  if(kind==="stock"){
    name="drone-stock-report.csv";
    rows.push(["Drone ID","Drone Name","Category","Status Today","Approved Bookings","Booked Days"]);
    DRONES.forEach(d=>{const b=A.filter(r=>r.droneId===d.id);
      rows.push([d.id,d.name,d.category,droneOut(d.id)?"Out":"In stock",b.length,b.reduce((s,r)=>s+spanDays(r.requiredDate,r.handoverDate),0)]);});
  }
  if(kind==="monthly"){
    name="drone-monthly-usage.csv";
    rows.push(["Month","Drone ID","Drone Name","Category","Bookings","Days Used"]);
    const m={};
    A.forEach(r=>{const month=r.requiredDate.slice(0,7),k=month+"|"+r.droneId;
      m[k]=m[k]||{month,droneId:r.droneId,droneName:r.droneName,category:r.category,n:0,days:0};
      m[k].n++; m[k].days+=spanDays(r.requiredDate,r.handoverDate);});
    Object.values(m).sort((a,b)=>a.month.localeCompare(b.month)||a.droneId.localeCompare(b.droneId))
      .forEach(x=>rows.push([x.month,x.droneId,x.droneName,x.category,x.n,x.days]));
  }
  if(kind==="users"){
    name="drone-usage-by-employee.csv";
    rows.push(["Employee ID","Employee Name","Drone ID","Drone Name","Required Date","Handover Date","Days","Reason"]);
    A.slice().sort((a,b)=>a.requiredDate.localeCompare(b.requiredDate))
      .forEach(r=>rows.push([r.empId,r.empName,r.droneId,r.droneName,r.requiredDate,r.handoverDate,spanDays(r.requiredDate,r.handoverDate),r.reason]));
  }
  if(kind==="pilots"){
    name="pilot-movement-report.csv";
    rows.push(["Pilot ID","Pilot Name","Start Date","End Date","Days","Location","Purpose","Requested By ID","Requested By Name"]);
    approved("pilot").slice().sort((a,b)=>a.startDate.localeCompare(b.startDate))
      .forEach(r=>rows.push([r.pilotId,r.pilotName,r.startDate,r.endDate,r.days,r.location,r.reason,r.empId,r.empName]));
  }
  return {name,csv:rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n")};
}

// ---- layout ----
function render(){
  document.title=TITLE;
  const app=document.getElementById("app");
  if(!S.user){app.innerHTML=loginView()+(S.toast?`<div class="toast">${esc(S.toast)}</div>`:"");return;}
  const role=S.user.role, admin=role==="admin";
  const tabs=admin
    ?[["home","Home"],["inventory","Inventory"],["approvals",`Approvals${pendingCount()?` (${pendingCount()})`:""}`],["status","Status"],["reports","Reports"],["settings","Settings"]]
    :role==="pilot"
      ?[["home","Home"],["leave","Apply Leave"],["mine","My Requests"],["inventory","Inventory"]]
      :[["home","Home"],["drone","Request Drone"],["mine","My Requests"],["drive","Drone In / Out"],["inventory","Inventory"]];
  const current=S.view;
  const views={home,drive:driveView,drone:droneReq,pilot:pilotReq,leave:leaveView,mine:mineView,inventory:inventoryView,approvals:approvalsView,status:statusView,reports:reportsView,settings:settingsView};
  const ok=tabs.some(([v])=>v===current)||(current==="pilot"&&role==="user");
  const body=ok?views[current]:home;
  const who=admin?"Admin":role==="pilot"?`Pilot · ${esc(S.user.empName)}`:`${esc(S.user.empName)} (${esc(S.user.empId)})`;
  app.innerHTML=`
    <header><span></span><div class="brand"><img src="assets/logo.jpg" alt="Logo"><h1>${esc(TITLE)}</h1></div>
      <div class="who">${who} &middot; <a href="#" data-act="logout" style="color:#fff">Log out</a></div></header>
    <nav>${tabs.map(([v,t])=>`<button class="${current===v||(current==="pilot"&&v==="home")?"on":""}" data-act="go" data-v="${v}">${esc(t)}</button>`).join("")}</nav>
    <main>
      ${!S.ready&&!S.dbErr?`<div class="card muted">Connecting to shared data...</div>`:""}
      ${S.dbErr?`<div class="banner">${esc(S.dbErr)}</div>`:""}
      ${body()}
    </main>
    ${S.toast?`<div class="toast">${esc(S.toast)}</div>`:""}`;
}

function flash(m){S.toast=m;render();setTimeout(()=>{S.toast="";render()},3500)}

// ---- events ----
document.addEventListener("input",e=>{
  const t=e.target;
  if(!t.dataset) return;
  if(t.dataset.edit){
    const E=S.edit; if(!E) return;
    if(t.dataset.edit==="title") E.title=t.value;
    else {const list=t.dataset.edit==="drone"?E.drones:E.pilots; list[+t.dataset.i][t.dataset.f]=t.value;}
    return;
  }
  if(t.dataset.scope){S[t.dataset.scope][t.dataset.k]=t.value;}
});

// Read login fields straight from the screen so typed values are never lost
function readLogin(k){
  const el=document.querySelector(`[data-scope="login"][data-k="${k}"]`);
  if(el){S.login[k]=el.value;return el.value;}
  return S.login[k]||"";
}
document.addEventListener("keydown",e=>{
  if(e.key==="Enter"&&e.target.dataset&&e.target.dataset.scope==="login"){
    const btn=document.querySelector('[data-act^="login-"]'); if(btn) btn.click();
  }
});

document.addEventListener("click",async e=>{
  const el=e.target.closest("[data-act]");
  if(!el) return;
  e.preventDefault();
  const a=el.dataset.act, v=el.dataset.v, id=el.dataset.id;
  switch(a){
    case "ltab": S.loginTab=v; S.loginErr=""; break;
    case "login-user":
      if(!S.login.empId.trim()||!S.login.empName.trim()){S.loginErr="Enter your employee ID and name.";break;}
      S.user={role:"user",empId:S.login.empId.trim(),empName:S.login.empName.trim()};
      S.view="home"; resetD(); resetP(); S.loginErr=""; break;
    case "login-admin": {
      const u=readLogin("user").trim(), p=readLogin("pass");
      if(u.toLowerCase()===ADMIN_USER&&p===ADMIN_PASS){S.user={role:"admin"};S.view="home";S.loginErr="";S.login.pass="";}
      else S.loginErr="Wrong username or password."; break;
    }
    case "login-pilot": {
      const name=(S.login.user||"").trim().toLowerCase(), pw=(S.login.pass||"").trim().toLowerCase();
      const pl=name&&PILOTS.find(x=>x.name.trim().toLowerCase()===name);
      if(!pl||pw!==name){S.loginErr="Wrong pilot name or password.";break;}
      S.user={role:"pilot",pilotId:pl.id,empId:pl.id,empName:pl.name};
      S.view="home"; S.login.pass=""; S.loginErr=""; resetP(); resetL(); break;
    }
    case "logout": S.user=null; S.login.pass=""; S.view="home"; break;
    case "go":
      if(v==="settings"&&S.user?.role!=="admin") break;
      S.view=v; S.msg="";
      if(v==="drone") resetD();
      if(v==="pilot") resetP();
      if(v==="leave") resetL();
      if(v==="settings"&&!S.edit) S.edit=JSON.parse(JSON.stringify({title:TITLE,drones:DRONES,pilots:PILOTS}));
      break;
    case "filter": S.filter=v; break;
    case "pick-drone": S.d.droneId=id; S.d.step=1; S.msg=""; break;
    case "d-back": S.d.step=Math.max(0,S.d.step-1); S.msg=""; break;
    case "d-next": {
      const d=S.d;
      if(!d.empId?.trim()||!d.empName?.trim()) S.msg="Enter employee ID and name.";
      else if(!d.requiredDate||!d.handoverDate) S.msg="Select both the required date and the handover date.";
      else if(d.requiredDate<today()) S.msg="Required date cannot be in the past.";
      else if(d.handoverDate<d.requiredDate) S.msg="Handover date must be on or after the required date.";
      else {S.d.step=2; S.msg="";}
      break;
    }
    case "d-submit": {
      if(S.busy) break;
      const d=S.d;
      if(!d.reason?.trim()){S.msg="Please write the reason.";break;}
      const dr=DRONES.find(x=>x.id===d.droneId);
      if(!dr){S.msg="This drone is no longer in the list. Please choose again.";S.d={step:0};break;}
      S.busy=true;
      try{
        await save({type:"drone",status:"pending",droneId:dr.id,droneName:dr.name,category:dr.category,
          requiredDate:d.requiredDate,handoverDate:d.handoverDate,reason:d.reason.trim(),
          empId:d.empId.trim(),empName:d.empName.trim()});
        resetD(); S.view="mine"; S.msg="";
        flash("Drone request sent to admin for approval.");
      }catch(err){S.msg="Could not send request: "+err.message;}
      S.busy=false; break;
    }
    case "pick-pilot": S.p.pilotId=id; S.p.step=1; S.msg=""; break;
    case "p-back": S.p.step=0; S.msg=""; break;
    case "p-submit": {
      if(S.busy) break;
      const p=S.p, days=parseInt(p.days,10);
      if(!p.empId?.trim()||!p.empName?.trim()) {S.msg="Enter employee ID and name.";break;}
      if(!p.startDate){S.msg="Select the pilot required date.";break;}
      if(p.startDate<today()){S.msg="Required date cannot be in the past.";break;}
      if(!(days>=1)){S.msg="Enter the number of days (1 or more).";break;}
      if(!p.location?.trim()){S.msg="Enter the location.";break;}
      if(!p.reason?.trim()){S.msg="Enter the reason for the pilot.";break;}
      const pl=PILOTS.find(x=>x.id===p.pilotId);
      if(!pl){S.msg="This pilot is no longer listed. Please choose again.";S.p={step:0};break;}
      S.busy=true;
      try{
        await save({type:"pilot",status:"pending",pilotId:pl.id,pilotName:pl.name,startDate:p.startDate,
          days,endDate:addDays(p.startDate,days-1),location:p.location.trim(),reason:p.reason.trim(),
          empId:p.empId.trim(),empName:p.empName.trim()});
        resetP(); S.view="mine"; S.msg="";
        flash("Pilot request sent to admin for approval.");
      }catch(err){S.msg="Could not send request: "+err.message;}
      S.busy=false; break;
    }
    case "l-submit": {
      if(S.busy) break;
      const l=S.l, pl=PILOTS.find(x=>x.id===S.user.pilotId);
      if(!pl){S.msg="Your pilot record was not found.";break;}
      if(!l.reason?.trim()){S.msg="Enter the reason.";break;}
      let s,e;
      if(l.kind==="half"){
        if(!l.date){S.msg="Select the date.";break;}
        if(l.date<today()){S.msg="Date cannot be in the past.";break;}
        s=e=l.date;
      }else{
        if(!l.from||!l.to){S.msg="Select the from and to dates.";break;}
        if(l.from<today()){S.msg="From date cannot be in the past.";break;}
        if(l.to<l.from){S.msg="To date must be on or after the from date.";break;}
        s=l.from; e=l.to;
      }
      S.busy=true;
      try{
        await save({type:"leave",leaveKind:l.kind==="half"?"half":"full",session:l.kind==="half"?(l.session||"Morning"):"",
          status:"pending",pilotId:pl.id,pilotName:pl.name,startDate:s,endDate:e,
          days:l.kind==="half"?0.5:spanDays(s,e),reason:l.reason.trim(),empId:S.user.empId,empName:S.user.empName});
        resetL(); S.view="mine"; S.msg="";
        flash("Leave request sent to admin.");
      }catch(err){S.msg="Could not send: "+err.message;}
      S.busy=false; break;
    }
    case "set-status": {
      if(S.busy) break;
      const kind=el.dataset.kind, bucket=kind==="drone"?"drones":"pilots", key=kind+":"+id;
      const cur=S.statusMap[bucket]?.[id]||{}, dr=S.sd[key]||{};
      const state=dr.state??cur.state??"available";
      const reason=(dr.reason??cur.reason??"").trim();
      if(state!=="available"&&!reason){flash("Enter a reason first.");break;}
      const next={drones:{...S.statusMap.drones},pilots:{...S.statusMap.pilots}};
      next[bucket][id]={state,reason:state==="available"?"":reason,at:Date.now()};
      S.busy=true;
      try{
        await db.collection("config").doc("status").set(next);
        delete S.sd[key];
        flash("Status updated for everyone.");
      }catch(err){flash("Could not save status: "+err.message);}
      S.busy=false; break;
    }
    case "ret-request":
      if(S.busy) break;
      S.busy=true;
      try{await db.collection("requests").doc(id).update({ret:"requested",retRequestedAt:Date.now()});
        flash("Return sent to admin for acceptance.");}
      catch(err){flash("Could not send return: "+err.message);}
      S.busy=false; break;
    case "ret-accept":
      if(S.busy) break;
      S.busy=true;
      try{await db.collection("requests").doc(id).update({ret:"returned",returnedDate:today(),returnedAt:Date.now()});
        flash("Return accepted. Drone is back in stock.");}
      catch(err){flash("Could not accept return: "+err.message);}
      S.busy=false; break;
    case "ret-reject":
      if(S.busy) break;
      S.busy=true;
      try{await db.collection("requests").doc(id).update({ret:"none"});
        flash("Marked as not received.");}
      catch(err){flash("Could not update: "+err.message);}
      S.busy=false; break;
    case "pilot-back":
      if(S.busy) break;
      S.busy=true;
      try{await writeStatus("pilots",id,{state:"available",at:Date.now()});
        flash("You are now Available on everyone's dashboard.");}
      catch(err){flash("Could not update: "+err.message);}
      S.busy=false; break;
    case "decide":
      if(S.busy) break;
      S.busy=true;
      try{await db.collection("requests").doc(id).update({status:v,decidedAt:Date.now()});
        flash(v==="approved"?"Request approved.":"Request rejected.");}
      catch(err){flash("Could not update: "+err.message);}
      S.busy=false; break;
    case "drone-report": {
      const r=droneReport(S.rep.drone,S.rep.month);
      if(!r){flash("Select a drone first.");break;}
      if(!downloads){flash("Download is not available in this view.");break;}
      try{const res=await downloads.save({filename:r.name,data:r.csv});
        flash(res.status==="saved"?"Report saved: "+r.name:"Download cancelled.");}
      catch(err){flash("Could not save report.");}
      break;
    }
    case "report": {
      const {name,csv}=reportCSV(v);
      if(!downloads){flash("Download is not available in this view.");break;}
      try{const r=await downloads.save({filename:name,data:csv});
        flash(r.status==="saved"?"Report saved: "+name:"Download cancelled.");}
      catch(err){flash("Could not save report.");}
      break;
    }
    // ---- admin settings ----
    case "rm": {
      const kind=el.dataset.kind, i=+el.dataset.i;
      S.edit[kind].splice(i,1); break;
    }
    case "add-drone": {
      const n=(S.nd.name||"").trim();
      if(!n){flash("Enter a drone name first.");break;}
      if(S.busy) break;
      S.busy=true;
      const item={id:newId("D"),name:n,category:(S.nd.category||"").trim()||"Other",vendor:(S.nd.vendor||"").trim()};
      S.edit.drones.push(item);
      try{await persistSettings(S.edit); S.nd={name:"",category:S.nd.category,vendor:S.nd.vendor}; flash(`Drone "${n}" added and saved.`);}
      catch(err){S.edit.drones=S.edit.drones.filter(d=>d!==item); flash("Could not add drone: "+err.message);}
      S.busy=false; break;
    }
    case "add-pilot": {
      const n=(S.np.name||"").trim();
      if(!n){flash("Enter a pilot name first.");break;}
      if(S.busy) break;
      S.busy=true;
      const item={id:newId("P"),name:n};
      S.edit.pilots.push(item);
      try{await persistSettings(S.edit); S.np={name:""}; flash(`Pilot "${n}" added and saved.`);}
      catch(err){S.edit.pilots=S.edit.pilots.filter(p=>p!==item); flash("Could not add pilot: "+err.message);}
      S.busy=false; break;
    }
    case "reset-edit":
      S.edit=JSON.parse(JSON.stringify({title:TITLE,drones:DRONES,pilots:PILOTS})); flash("Changes discarded."); break;
    case "save-cfg": {
      if(S.busy) break;
      const E=S.edit;
      const title=(E.title||"").trim()||DEFAULT_TITLE;
      const drones=E.drones.map(d=>({id:d.id,name:(d.name||"").trim(),category:(d.category||"").trim()||"Other",vendor:(d.vendor||"").trim()})).filter(d=>d.name);
      const pilots=E.pilots.map(p=>({id:p.id,name:(p.name||"").trim()})).filter(p=>p.name);
      if(!drones.length){flash("Keep at least one drone in the list.");break;}
      S.busy=true;
      try{
        await db.collection("config").doc("app").set({title,drones,pilots});
        TITLE=title; DRONES=drones; PILOTS=pilots;
        S.edit=JSON.parse(JSON.stringify({title,drones,pilots}));
        flash("Settings saved. Everyone now sees the updated lists.");
      }catch(err){flash("Could not save settings: "+err.message);}
      S.busy=false; break;
    }
  }
  render();
});

document.addEventListener("change",e=>{
  const t=e.target;
  if(t.dataset&&t.dataset.scope){S[t.dataset.scope][t.dataset.k]=t.value;render();}
});

document.addEventListener("input",e=>{
  const t=e.target;
  if(t.dataset&&t.dataset.sk){S.sd[t.dataset.sk]=S.sd[t.dataset.sk]||{};S.sd[t.dataset.sk][t.dataset.sf]=t.value;}
});
document.addEventListener("change",e=>{
  const t=e.target;
  if(t.dataset&&t.dataset.sk){S.sd[t.dataset.sk]=S.sd[t.dataset.sk]||{};S.sd[t.dataset.sk][t.dataset.sf]=t.value;render();}
});

async function persistSettings(E){
  const title=(E.title||"").trim()||DEFAULT_TITLE;
  const drones=E.drones.map(d=>({id:d.id,name:(d.name||"").trim(),category:(d.category||"").trim()||"Other",vendor:(d.vendor||"").trim()})).filter(d=>d.name);
  const pilots=E.pilots.map(p=>({id:p.id,name:(p.name||"").trim()})).filter(p=>p.name);
  await db.collection("config").doc("app").set({title,drones,pilots});
  TITLE=title; DRONES=drones; PILOTS=pilots;
  S.edit=JSON.parse(JSON.stringify({title,drones,pilots}));
}
async function save(obj){
  if(!db) throw new Error("shared data is not connected");
  const id="r_"+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  await db.collection("requests").doc(id).set({...obj,id,createdAt:Date.now()});
}

// ---- start ----
// Saves a CSV file to the visitor's computer (replaces the artifact download service)
function makeDownloader(){
  return {save:async({filename,data})=>{
    const url=URL.createObjectURL(new Blob([data],{type:"text/csv;charset=utf-8"}));
    const a=document.createElement("a"); a.href=url; a.download=filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    return {status:"saved"};
  }};
}
async function init(){
  resetD(); resetP(); resetL();
  render();
  try{
    if(FIREBASE_CONFIG.apiKey.startsWith("PASTE")){
      S.dbErr="Setup needed: paste your Firebase keys into FIREBASE_CONFIG in this file.";render();return;
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    db=firebase.firestore();
    downloads=makeDownloader();
    db.collection("config").doc("app").onSnapshot(snap=>{
      if(snap.exists){
        const c=snap.data();
        TITLE=c.title||DEFAULT_TITLE;
        DRONES=Array.isArray(c.drones)?c.drones:DEFAULT_DRONES;
        PILOTS=Array.isArray(c.pilots)?c.pilots:DEFAULT_PILOTS;
      }
      render();
    },err=>{S.dbErr="Settings error: "+err.message;render();});
    db.collection("config").doc("status").onSnapshot(snap=>{
      const d=snap.exists?snap.data():{};
      S.statusMap={drones:d.drones||{},pilots:d.pilots||{}};
      render();
    },err=>{S.dbErr="Status error: "+err.message;render();});
    db.collection("requests").onSnapshot(snap=>{
      S.reqs=snap.docs.map(d=>({...d.data(),id:d.id}));
      S.ready=true; render();
    },err=>{S.dbErr="Data error: "+err.message;render();});
  }catch(err){S.dbErr="Could not connect: "+(err&&err.message||err);render();}
}
init();
