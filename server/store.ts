import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {AlertRule,AlertEvent} from '../src/types.ts';
export type PushSubscriptionRecord={endpoint:string;keys:{p256dh:string;auth:string}};
export type Store={alerts:AlertRule[];events:AlertEvent[];subscriptions:PushSubscriptionRecord[]};
const FILE=resolve(process.env.DATA_DIR??'data','state.json');let data:Store={alerts:[],events:[],subscriptions:[]};let pending:Promise<void>=Promise.resolve();
export async function load(){try{const raw=JSON.parse(await readFile(FILE,'utf8')) as Store;data={alerts:raw.alerts??[],events:raw.events??[],subscriptions:raw.subscriptions??[]};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
export function snapshot():Store{return JSON.parse(JSON.stringify(data)) as Store;}
async function save(){const state=JSON.stringify(data);pending=pending.catch(()=>{}).then(async()=>{await mkdir(dirname(FILE),{recursive:true});const tmp=FILE+'.'+randomUUID()+'.tmp';await writeFile(tmp,state,{mode:0o600});await rename(tmp,FILE);});await pending;}
export async function addAlert(alert:AlertRule){if(data.alerts.length>=250)throw Error('Alert limit reached');data.alerts.push(alert);await save();}
export async function deleteAlert(id:string){data.alerts=data.alerts.filter(x=>x.id!==id);await save();}
export async function triggered(rule:AlertRule,message:string){const original=data.alerts.find(x=>x.id===rule.id);if(!original)return null;const now=Date.now();if(original.lastTriggeredAt&&now-original.lastTriggeredAt<300_000)return null;original.lastTriggeredAt=now;const e:AlertEvent={id:randomUUID(),assetId:rule.assetId,kind:rule.kind,time:now,message};data.events.unshift(e);data.events=data.events.slice(0,150);await save();return e;}
export async function subscribe(record:PushSubscriptionRecord){if(!data.subscriptions.some(x=>x.endpoint===record.endpoint)){data.subscriptions.push(record);await save();}}
export async function forgetSubscription(endpoint:string){data.subscriptions=data.subscriptions.filter(x=>x.endpoint!==endpoint);await save();}
