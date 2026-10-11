export const CAPABILITIES = Object.freeze(["clock","random","net.client","net.server","fs.read","fs.write","threads","interop.java","interop.native","device.camera","device.gpio","dynamic.code","heap","gc"]);
export const ENVIRONMENTS = Object.freeze(["server","desktop","browser","edge-js","edge-wasi","ios","android","embedded"]);
export const BACKENDS = Object.freeze(["llvm","graal","wasm","javascript","dex","c","bytecode"]);
const unique = a => Array.isArray(a) && a.every((x,i) => typeof x === "string" && x.length>0 && a.indexOf(x)===i);
const subset = (a,b) => a.every(x=>b.includes(x));
export function validateRegistry(profiles) {
  const errors=[],seen=new Set();
  if (!Array.isArray(profiles)) return {ok:false,errors:["registry must be an array"]};
  for (const [i,p] of profiles.entries()) {
    const at="profiles["+i+"]";
    if (!p || typeof p!=="object" || Array.isArray(p)) {errors.push(at+": expected object");continue}
    if (p.schemaVersion!==1 || !ENVIRONMENTS.includes(p.name)) errors.push(at+": unknown schema or target");
    if (seen.has(p.name)) errors.push(at+": duplicate environment "+p.name);
    seen.add(p.name);
    if (!unique(p.backends)||p.backends.length===0||!subset(p.backends,BACKENDS)) errors.push(at+": invalid backends");
    if (!unique(p.capabilities)||!subset(p.capabilities,CAPABILITIES)) errors.push(at+": invalid capabilities");
    for (const k of Object.keys(p)) if (!["schemaVersion","name","backends","capabilities","notes"].includes(k)) errors.push(at+": unknown property "+k);
  }
  for (const name of ENVIRONMENTS) if (!seen.has(name)) errors.push("missing profile "+name);
  return {ok:errors.length===0,errors};
}
export function validateClosure(input,profiles) {
  if(!input||typeof input!=="object"||Array.isArray(input))
    return {ok:false,errors:["resolved graph must be an object"]};
  const {schemaVersion,nodes,entry,target,backend,grants=[]}=input;
  const errors=[];
  for(const key of Object.keys(input))
    if(!["schemaVersion","nodes","entry","target","backend","grants"].includes(key))
      errors.push("unknown resolved-graph property "+key);
  if(schemaVersion!==1)errors.push("unsupported or missing resolved-graph schemaVersion");
  if(typeof backend!=="string"||!BACKENDS.includes(backend))errors.push("missing or unknown backend");
  const registry=validateRegistry(profiles);
  if (!registry.ok) return registry;
  const profile=profiles.find(x=>x.name===target);
  if (!profile) errors.push("unknown requested target: "+target);
  if (backend!==undefined && (!BACKENDS.includes(backend)||!profile?.backends.includes(backend))) errors.push("backend "+backend+" is not declared for "+target);
  if (!unique(grants)||!subset(grants,CAPABILITIES)) errors.push("invalid or duplicate grants");
  if (profile && unique(grants) && !subset(grants,profile.capabilities)) errors.push("capability grant unavailable in "+target);
  if (!Array.isArray(nodes)||nodes.length===0) return {ok:false,errors:[...errors,"nodes must be a nonempty array"]};
  if(nodes.length>4096)return {ok:false,errors:[...errors,"resolved graph exceeds 4096 units"]};
  const ids=new Map();
  for(const [i,node] of nodes.entries()){
    const at="nodes["+i+"]";
    if(!node||typeof node!=="object"||Array.isArray(node)){errors.push(at+": expected object");continue}
    if(typeof node.id!=="string"||node.id.length===0||node.id.length>512||node.id.includes("\u0000")){errors.push(at+": invalid id");continue}
    if(ids.has(node.id))errors.push(at+": duplicate id "+node.id);
    ids.set(node.id,node);
    if(!unique(node.targets)||node.targets.length===0||!subset(node.targets,ENVIRONMENTS))errors.push(node.id+": invalid targets");
    if(!unique(node.requires)||!subset(node.requires,CAPABILITIES))errors.push(node.id+": invalid requires");
    if(!unique(node.imports)||node.imports.length>256||node.imports.some(x=>x.length>512||x.includes("\u0000")))errors.push(node.id+": invalid or excessive imports");
    for(const field of Object.keys(node))if(!["id","targets","requires","imports"].includes(field))errors.push(node.id+": unknown property "+field);
  }
  if(!ids.has(entry))errors.push("missing entry "+entry);
  if(errors.length) return {ok:false,errors};
  // Iterative graph traversal avoids adversarial recursion depth and ensures
  // cycles terminate. Check the promised target set of *every* import edge,
  // not just compatibility with today's selected compilation target.
  const visited=new Set();
  const pending=[entry];
  let edges=0;
  while(pending.length){
    const id=pending.pop();
    if(visited.has(id))continue;
    visited.add(id);
    const a=ids.get(id);
    if(!a.targets.includes(target))errors.push(id+": target "+target+" not admitted");
    if(!subset(a.requires,grants))errors.push(id+": missing build grants "+a.requires.filter(x=>!grants.includes(x)).join(","));
    if(profile&&!subset(a.requires,profile.capabilities))errors.push(id+": target "+target+" lacks declared capabilities");
    for(const dep of a.imports){
      edges++;
      if(edges>65536)return {ok:false,errors:[...errors,"resolved graph exceeds 65536 import edges"]};
      if(!ids.has(dep)){errors.push(id+": unresolved import "+dep);continue}
      const b=ids.get(dep);
      if(!subset(a.targets,b.targets))errors.push(id+" -> "+dep+": imported targets do not cover importer targets");
      if(!subset(b.requires,a.requires))errors.push(id+" -> "+dep+": imported requirements are not declared by importer");
      if(!visited.has(dep))pending.push(dep);
    }
  }
  if(visited.size!==ids.size) errors.push("graph contains "+(ids.size-visited.size)+" unreachable units; supply exact linked closure");
  // A resolved, closed dependency graph has an exact effect budget. Reject
  // unused grants rather than provisioning authority no unit can justify.
  const used=new Set();
  for(const unit of ids.values())for(const effect of unit.requires)used.add(effect);
  const unused=grants.filter(capability=>!used.has(capability));
  if(unused.length)errors.push("unused build grants: "+unused.join(","));
  return {ok:errors.length===0,errors,visited:visited.size};
}
