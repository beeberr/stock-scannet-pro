export type EngineAvailability='LOADING'|'READY'|'PARTIAL'|'UNAVAILABLE';
export type DataAvailability=Exclude<EngineAvailability,'LOADING'>;
export function summarizeStatus(ready:number,total:number,observed=ready):DataAvailability{
 if(total<=0||observed<=0)return 'UNAVAILABLE';
 if(ready>=total)return 'READY';
 return 'PARTIAL';
}
export function statusForTechnicalData(data:Record<string,any>,engine:'technical'|'momentum'):DataAvailability{
 const rows=Object.values(data||{}),observed=rows.filter((r:any)=>r?.[engine]&&typeof r[engine]==='object').length,ready=rows.filter((r:any)=>r?.[engine]?.status==='READY').length;
 return summarizeStatus(ready,rows.length,observed);
}
export function statusForMacroSeries(series:Record<string,any>):DataAvailability{
 const rows=Object.values(series||{}),observed=rows.filter((r:any)=>r?.latest!==null&&r?.latest!==undefined).length,ready=rows.filter((r:any)=>r?.status==='READY').length;
 return summarizeStatus(ready,rows.length,observed);
}
export function statusForValueData(data:Record<string,any>):DataAvailability{
 const rows=Object.values(data||{}),observed=rows.filter((r:any)=>r?.status==='READY').length,ready=rows.filter((r:any)=>r?.status==='READY'&&r?.partial!==true&&Boolean(r?.valuation||r?.latestFinancials)).length;
 return summarizeStatus(ready,rows.length,observed);
}
export function statusForCommodityData(data:Record<string,any>,stale=false):DataAvailability{
 const rows=Object.values(data||{}),observed=rows.filter((r:any)=>r?.available===true).length,ready=rows.filter((r:any)=>r?.available===true&&r?.research?.technical?.status==='READY'&&r?.research?.momentum?.status==='READY').length;
 if(stale&&observed>0)return 'PARTIAL';
 return summarizeStatus(ready,rows.length,observed);
}
export function statusForIndicesPayload(p:Record<string,any>):DataAvailability{
 const rows=Object.values(p?.data||{}),total=Number(p?.total)||rows.length,ready=rows.filter((r:any)=>r?.status==='READY').length;
 return summarizeStatus(ready,total,ready);
}
export function statusForQuotesPayload(p:Record<string,any>):DataAvailability{
 const total=Number(p?.total)||0,available=Number(p?.available)||0;
 return summarizeStatus(available,total,available);
}
export function statusForNewsPayload(p:Record<string,any>):DataAvailability{
 const errors=p?.errors;
 if(!errors||typeof errors!=='object')return p?.status==='READY'?'READY':'UNAVAILABLE';
 const ok=['news','earnings'].filter(k=>errors[k]===null||errors[k]===undefined).length;
 return summarizeStatus(ok,2,ok);
}
export function statusForDisclosureData(data:Record<string,any>):DataAvailability{
 const rows=Object.values(data||{}),checked=rows.filter((r:any)=>r?.status==='READY'||r?.status==='NO_RECENT_MATCHES').length;
 return summarizeStatus(checked,rows.length,checked);
}
export function statusLabel(s:EngineAvailability):string{
 return s==='LOADING'?'בבדיקה':s==='READY'?'READY · מלא':s==='PARTIAL'?'PARTIAL · חלקי':'UNAVAILABLE · לא זמין';
}
