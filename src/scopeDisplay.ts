import * as THREE from 'three';

/** RHODA display chrome around the shared analytical waveform, not R&S firmware. */
export function createScopeDisplay(source:HTMLCanvasElement) {
 const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=1000;
 const c=canvas.getContext('2d')!;
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 function text(value:string,x:number,y:number,size=26,color='#cedce5'){c.fillStyle=color;c.font=`500 ${size}px monospace`;c.fillText(value,x,y);}
 const unit=(n:number,suffix:string)=>{const a=Math.abs(n);const [m,p]=a>0&&a<.000001?[1e9,'n']:a>0&&a<.001?[1e6,'u']:a>0&&a<1?[1e3,'m']:[1,''];return `${Number((n*m).toPrecision(4))} ${p}${suffix}`;};
 function paint(frame?:any){
 c.fillStyle='#081017';c.fillRect(0,0,1600,1000);c.fillStyle='#172a35';c.fillRect(0,0,1600,110);c.fillRect(0,880,1600,120);
 text('RHODA / TRAINING',24,42,28,'#8be9cf');text('ANALYTICAL PREVIEW',1110,42,26,'#99aebe');
 if(!frame){text('Waiting for simulator readback',340,500,36);texture.needsUpdate=true;return;}
 const active=['CH1','CH2','CH3','CH4'].filter(source=>frame.state.channels[source.slice(-1)]?.enabled);
 text(`ACTIVE  ${active.join(' / ')||'NONE'}`,24,86,28,'#ffe070');text(`TIME  ${unit(frame.state.timebase_scale,'s')}/div`,510,86);text(`TRIGGER ${frame.state.trigger.source}  ${unit(frame.state.trigger.level,'V')}`,1060,86);
 c.drawImage(source,60,135,1480,710);
 c.strokeStyle='#738a99';c.setLineDash([7,9]);c.beginPath();c.moveTo(800,135);c.lineTo(800,845);c.moveTo(60,490);c.lineTo(1540,490);c.stroke();c.setLineDash([]);
 const triggerChannel=frame.state.channels[String(frame.state.trigger.source.slice(-1))]??frame.state.channels['1'];
 const triggerY=490-frame.state.trigger.level/triggerChannel.vertical_scale*710/8-triggerChannel.offset/triggerChannel.vertical_scale*710/8;
 if(triggerY>=135&&triggerY<=845){c.fillStyle='#7de2cc';c.beginPath();c.moveTo(1538,triggerY);c.lineTo(1560,triggerY-13);c.lineTo(1560,triggerY+13);c.fill();}
 text(`-${unit(frame.state.timebase_scale*5,'s')}`,60,873,22);text('0 s',775,873,22);text(`+${unit(frame.state.timebase_scale*5,'s')}`,1350,873,22);
 text(`${active.map(source=>`${source} ${unit(frame.state.channels[source.slice(-1)].vertical_scale,'V')}/div`).join('  ·  ')||'Enable a channel to display a trace'}`,24,925,26,'#ffe070');text(`SHARED SOURCE ${frame.scenario.toUpperCase()}`,24,962,23);text(`${frame.state.acquisition_state} / static preview`,1010,962,24);
 const warnings=active.flatMap(source=>{const trace=frame.traces?.[source]??(source==='CH1'?frame:null);return[trace?.clipped?`${source} CLIPPED`:'',trace?.undersampled?`${source} UNDERSAMPLED`:'',source===frame.state.trigger.source&&trace&&!trace.trigger_possible?'NO TRIGGER CROSSING':''];}).filter(Boolean);
 text(warnings.join(' | ')||'Ideal signal - no physical instrument connected',24,992,23,warnings.length?'#ffc27a':'#8ba4b4');texture.needsUpdate=true;
 }
 paint();return {texture,update:paint};
}
