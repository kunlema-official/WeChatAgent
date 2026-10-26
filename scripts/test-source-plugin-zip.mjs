import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {verifySourcePluginZip} from './source-release-policy.mjs';
import {packZip} from '../packages/plugin-api/zip.mjs';
import {packageFiles} from '../packages/plugin-api/catalog.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'source-plugin-audit-')),source=path.join(root,'optional-extensions/fish-notebook');fs.cpSync(path.resolve('optional-extensions/fish-notebook'),source,{recursive:true});t.after(()=>{assert(root.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});return {root,source,zip:()=>packZip(packageFiles(source))};}
test('only the exact current first-party plugin payload is accepted, without executing its entry',t=>{const f=fixture(t),marker=path.join(f.root,'executed');fs.appendFileSync(path.join(f.source,'index.mjs'),`\nimport fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'executed');`);const result=verifySourcePluginZip(f.root,f.zip());assert.equal(result.entries.length,4);assert.equal(fs.existsSync(marker),false);});
test('extra private payload, outdated bytes and identity substitutions are rejected',t=>{const f=fixture(t),files=packageFiles(f.source),zip=f.zip();assert.throws(()=>verifySourcePluginZip(f.root,packZip([...files,{name:'state/secret.json',data:'private'}])),/FILE_SET/);fs.appendFileSync(path.join(f.source,'index.mjs'),'\n// changed');assert.throws(()=>verifySourcePluginZip(f.root,zip),/CONTENT_MISMATCH/);const manifest=path.join(f.source,'plugin.json'),item=JSON.parse(fs.readFileSync(manifest));item.version='9.0.0';fs.writeFileSync(manifest,JSON.stringify(item));assert.throws(()=>verifySourcePluginZip(f.root,f.zip()),/IDENTITY/);});
test('an ignored file in the plugin source cannot slip into the approved ZIP exception',t=>{const f=fixture(t);fs.writeFileSync(path.join(f.source,'private.txt'),'not a public source file');assert.throws(()=>verifySourcePluginZip(f.root,f.zip()),/FILE_SET/);});
