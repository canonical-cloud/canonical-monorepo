import {readFile,readdir} from "node:fs/promises";
const directory=new URL("../profiles/",import.meta.url);
export async function loadProfiles(){
 const names=(await readdir(directory)).filter(name=>name.endsWith(".json")).sort();
 return Promise.all(names.map(async name=>JSON.parse(await readFile(new URL(name,directory),"utf8"))));
}
