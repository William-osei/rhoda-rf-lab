/** Parse only explicit, single instrument-setting requests. Questions remain guidance. */
export function detectAction(text: string): {path:string;value:string|number}|null {
 const input=text.trim().toLowerCase().replace(/[.!]$/, '');
 const n='([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))';
 const lead='^(?:please )?(?:set|change|adjust) (?:the )?';
 let m=input.match(new RegExp(lead+'(?:timebase|time base|time/div)(?: to)? '+n+'\\s*(ms|us|µs|ns|s)(?:/div)?$'));
 if(m)return {path:'timebase.scale',value:Number(m[1])*({s:1,ms:1e-3,us:1e-6,'µs':1e-6,ns:1e-9}[m[2]]!)};
 m=input.match(new RegExp(lead+'(?:(?:ch|channel) ?([1-4]) )?(?:vertical scale|v/div|volts per division)(?: to)? '+n+'\\s*(mv|v)(?:/div)?(?: on ch([1-4]))?$'));
 if(m)return {path:`channel.${m[1]||m[4]||'1'}.vertical_scale`,value:Number(m[2])*(m[3]==='mv'?1e-3:1)};
 m=input.match(new RegExp(lead+'(?:(?:ch|channel) ?([1-4]) )?coupling(?: to)? (ac|dc)(?: on ch([1-4]))?$'));
 if(m)return {path:`channel.${m[1]||m[3]||'1'}.coupling`,value:m[2].toUpperCase()};
 m=input.match(new RegExp(lead+'trigger level(?: to)? '+n+'\\s*(mv|v)$'));
 if(m)return {path:'trigger.level',value:Number(m[1])*(m[2]==='mv'?1e-3:1)};
 m=input.match(new RegExp(lead+'trigger source(?: to)? (?:ch|channel) ?([1-4])$'));
 if(m)return {path:'trigger.source',value:'CH'+m[1]};
 return null;
}
