import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'../dist');
const entries=await fsp.readdir(root,{withFileTypes:true});
const lines=[];
for(const entry of entries.filter(item=>item.isFile()&&/^MOSS Eval-\d+\.\d+\.\d+-[^-]+-(?:setup|portable)\.exe(?:\.blockmap)?$/.test(item.name)).sort((a,b)=>a.name.localeCompare(b.name))){const data=await fsp.readFile(path.join(root,entry.name));lines.push(`${crypto.createHash('sha256').update(data).digest('hex')}  ${entry.name}`);}
await fsp.writeFile(path.join(root,'checksums.sha256'),lines.join('\n')+'\n','utf8');
