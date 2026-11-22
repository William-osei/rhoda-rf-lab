export type DesktopQuality='balanced'|'detail'|'economy';
const limits={balanced:{ratio:1.5,pixels:4_000_000},detail:{ratio:2,pixels:8_000_000},economy:{ratio:1,pixels:1_500_000}};
export function desktopPixelRatio(width:number,height:number,deviceRatio:number,quality:DesktopQuality):number {
 const limit=limits[quality];
 const area=Math.max(1,Number.isFinite(width)&&Number.isFinite(height)?width*height:1);
 const ratio=Number.isFinite(deviceRatio)&&deviceRatio>0?deviceRatio:1;
 return Math.min(ratio,limit.ratio,Math.sqrt(limit.pixels/area));
}
export function frameSummary(samples:readonly number[]){
 const sorted=samples.filter(n=>Number.isFinite(n)&&n>0).sort((a,b)=>a-b);
 const percentile=(q:number)=>sorted.length?sorted[Math.max(0,Math.ceil(sorted.length*q)-1)]:null;
 return {samples:sorted.length,medianMs:percentile(.5),p95Ms:percentile(.95),over33ms:sorted.filter(n=>n>33.333).length};
}
