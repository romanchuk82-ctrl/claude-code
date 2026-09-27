import * as core from './multi-analyzer-core.js?v=25';
import { enrichJumpMetrics } from './analyzer.js?v=25';

export const beginMultiSession=core.beginMultiSession;
export const endMultiSession=core.endMultiSession;

export async function analyzeVideoRange(video,start,end,onProgress=()=>{}){
  const m=await core.analyzeVideoRange(video,start,end,p=>onProgress(Math.round(p*.92)));
  return enrichJumpMetrics(video,m,p=>onProgress(92+Math.round(p*.08)));
}
