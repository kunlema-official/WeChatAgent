import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {unpackZip} from '../packages/plugin-api/zip.mjs';
import {inspectPackage,packageFiles} from '../packages/plugin-api/catalog.mjs';
export const SOURCE_PLUGIN_ZIP='optional-extensions/packages/fish-notebook-1.0.0.zip';
export function verifySourcePluginZip(root,bytes){
  const source=path.join(root,'optional-extensions/fish-notebook'),item=inspectPackage(source),expected=['README.md','index.mjs','lib/notebook.mjs','plugin.json'].sort();
  if(item.id!=='fish-notebook'||item.version!=='1.0.0'||item.apiVersion!==2||item.host!=='wechatagent')throw Error('SOURCE_PLUGIN_IDENTITY_MISMATCH');
  const files=packageFiles(source),entries=unpackZip(bytes);
  for(const actual of [files,entries])if(JSON.stringify(actual.map(file=>file.name).sort())!==JSON.stringify(expected))throw Error('SOURCE_PLUGIN_FILE_SET_INVALID');
  for(const entry of entries){const original=files.find(file=>file.name===entry.name);if(!original.data.equals(entry.data))throw Error('SOURCE_PLUGIN_CONTENT_MISMATCH');}
  return {id:item.id,version:item.version,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),entries};
}
