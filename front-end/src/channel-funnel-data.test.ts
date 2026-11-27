import {expect,it} from 'vitest';
import {metaFunnelAction,metaFunnelSales} from './channel-funnel-data';
import type {FunnelResult} from '../../shared/funnel';
import type {MetaDashboard,MetaRow} from '../../shared/meta';

const period={start:'2026-11-01',end:'2026-11-20'};
const data={period,metaAdCohorts:[{adIds:['1','2'],leads:1,wonObserved:1},{adIds:['2'],leads:2,wonObserved:0},{adIds:['3'],leads:3,wonObserved:2}]} as FunnelResult;
const ad=(id:string,accountId:string)=>({id,accountId} as MetaRow);
const meta={period,available:true,total:{actions:{reply:0,started:12}},ads:[ad('1','a'),ad('2','a'),ad('3','b')],instagram:[ad('1','a')]} as unknown as MetaDashboard;

it('deduplicates contacts across matched ads and Instagram rows, and filters by account',()=>{
 expect(metaFunnelSales(data,meta,'')).toEqual({leads:6,won:3});
 expect(metaFunnelSales(data,meta,'a')).toEqual({leads:3,won:1});
 expect(metaFunnelSales(data,meta,'b')).toEqual({leads:3,won:2});
 expect(metaFunnelSales(data,meta,'unmatched')).toBeNull();
});

it('keeps absence, mismatched periods and partial collection distinct from zero',()=>{
 expect(metaFunnelSales(undefined,meta,'')).toBeNull();
 expect(metaFunnelSales(data,{...meta,period:{...period,end:'2026-11-21'}},'')).toBeNull();
 expect(metaFunnelSales(data,{...meta,available:false},'')).toBeNull();
 expect(metaFunnelSales({...data,metaAdCohorts:[]},meta,'')).toBeNull();
 expect(metaFunnelSales({...data,metaAdCohorts:[{adIds:['1'],leads:2,wonObserved:0}]},meta,'')).toEqual({leads:2,won:0});
 expect(metaFunnelAction(meta,'reply')).toBe(0);
 expect(metaFunnelAction(meta,'missing')).toBeNull();
 expect(metaFunnelAction({...meta,available:false},'started')).toBeNull();
});
