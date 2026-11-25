// Reading a report never uses this planner. Only an explicitly queued sync can
// extend stored coverage, resume a partial page, or read newly arrived events.
export function collectionWindow(progress:any,last:string,since:string,now:string,entry?:string,coverageStart?:string){
 const earliest=coverageStart??progress?.covered_from_utc??progress?.from_utc;
 const desired=entry&&entry>since?entry:since;
 const older=!!progress?.complete&&!progress.limited&&!!earliest&&desired<earliest;
 if(progress?.complete&&progress.until_utc>=last&&!older)return null;
 const resuming=!!progress?.cursor&&!progress.complete;
 const cursor=resuming?progress.cursor:older?earliest:now;
 const upper=resuming?(progress.page_upper_utc??progress.until_utc):cursor;
 const lower=resuming?progress.from_utc:older?desired:progress?.complete?progress.until_utc:since;
 return {cursor,upper,lower,latest:progress?.until_utc>upper?progress.until_utc:upper,earliest};
}
