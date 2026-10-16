import { mainContract, ridgecrest } from './fixtures';
import type { ContractInput, EventEvidence } from '../domain/types';

export type DemoScenario = {
 id: string;
 label: string;
 description: string;
 event: EventEvidence;
 contract: ContractInput & Pick<typeof mainContract, 'id'|'name'|'version'|'source'|'cedent'|'eventCap'|'areas'>;
};
export const highThresholdContract = {
 ...mainContract, id:'DEMO-CA-HIGH-THRESHOLD', name:'California Portfolio — high-threshold variant', minimumMagnitude:7.5,
};
export const incompleteContract = {
 ...mainContract, id:'DEMO-CA-INCOMPLETE', name:'California Portfolio — incomplete-coverage variant', inception:undefined, expiry:undefined,
};
export const scenarios: DemoScenario[] = [
 {id:'ridgecrest',label:'Ridgecrest replay',description:'Captured historical USGS earthquake evidence / fictional main treaty.',event:ridgecrest,contract:mainContract},
 {id:'high-threshold',label:'High threshold · known zero',description:'Captured Ridgecrest evidence / separate fictional RAS contract variant requiring minimum M7.5.',event:ridgecrest,contract:highThresholdContract},
 {id:'incomplete',label:'Missing coverage · needs review',description:'Captured Ridgecrest evidence / fictional RAS import missing both coverage dates.',event:ridgecrest,contract:incompleteContract},
 {id:'outside-coverage',label:'Outside coverage · known zero',description:'Captured Ridgecrest evidence / fictional RAS variant covering 2020 only. The historical occurrence is unchanged.',event:ridgecrest,contract:{...mainContract,id:'DEMO-CA-OUTSIDE',name:'California Portfolio — outside-coverage variant',inception:'2020-01-01T00:00:00Z',expiry:'2021-01-01T00:00:00Z'}},
 {id:'failed-and-missing',label:'Failed trigger + missing coverage',description:'Captured Ridgecrest evidence / fictional minimum-M7.5 import also missing both coverage dates. A known failure cannot establish zero.',event:ridgecrest,contract:{...incompleteContract,...highThresholdContract,id:'DEMO-CA-FAILED-INCOMPLETE',name:'California Portfolio — failed and incomplete variant',inception:undefined,expiry:undefined}},
];
