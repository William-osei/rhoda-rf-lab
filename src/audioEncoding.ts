/** Bounded blocks avoid the function-argument limit on longer recorded clips. */
export function bytesToBase64(bytes:Uint8Array){
  const blocks:string[]=[];
  for(let offset=0;offset<bytes.length;offset+=0x8000)blocks.push(String.fromCharCode(...bytes.subarray(offset,offset+0x8000)));
  return btoa(blocks.join(''));
}
