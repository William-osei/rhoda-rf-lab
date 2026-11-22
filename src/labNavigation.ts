/** Collision map for the authored desktop room; not a map of a physical lab. */
export type FloorPoint={x:number;z:number};
const step=.2,minX=-3.1,minZ=-5.5,cols=32,rows=35;
// Bounds include body clearance. Bench and chair rectangles are expanded by 0.30 m.
const obstacles=[{x0:-3.5,x1:-1.32,z0:-5.3,z1:-1.8},{x0:1.32,x1:3.5,z0:-5.3,z1:-1.8},{x0:1.82,x1:2.94,z0:-2.20,z1:-1.10}];
export function floorIsClear(p:FloorPoint){return p.x>=minX&&p.x<=3.1&&p.z>=minZ&&p.z<=1.3&&!obstacles.some(o=>p.x>=o.x0&&p.x<=o.x1&&p.z>=o.z0&&p.z<=o.z1);}
function point(i:number):FloorPoint{return {x:minX+(i%cols)*step,z:minZ+Math.floor(i/cols)*step};}
function nearest(p:FloorPoint){let index=-1,best=Infinity;for(let i=0;i<cols*rows;i++){const q=point(i);if(!floorIsClear(q))continue;const d=(q.x-p.x)**2+(q.z-p.z)**2;if(d<best){best=d;index=i;}}return index;}
export function segmentIsClear(a:FloorPoint,b:FloorPoint){const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.04));for(let i=0;i<=n;i++){const t=i/n;if(!floorIsClear({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t}))return false;}return true;}
export function planLabRoute(start:FloorPoint,target:FloorPoint):FloorPoint[]{
 // Never move an already invalid placement through geometry to recover it.
 if(!floorIsClear(start))return [];
 const from=nearest(start),to=nearest(target);if(from<0||to<0)return [];
 const end=floorIsClear(target)?target:point(to);
 if(segmentIsClear(start,end))return [end];
 const open=[from],cost=new Map([[from,0]]),previous=new Map<number,number>(),closed=new Set<number>();
 while(open.length){open.sort((a,b)=>(cost.get(a)!+Math.hypot(point(a).x-end.x,point(a).z-end.z))-(cost.get(b)!+Math.hypot(point(b).x-end.x,point(b).z-end.z)));const current=open.shift()!;if(current===to)break;closed.add(current);const x=current%cols,z=Math.floor(current/cols);
 for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const nx=x+dx,nz=z+dz;if(nx<0||nx>=cols||nz<0||nz>=rows)continue;const next=nz*cols+nx;if(closed.has(next)||!segmentIsClear(point(current),point(next)))continue;const candidate=cost.get(current)!+Math.hypot(dx,dz)*step;if(candidate<(cost.get(next)??Infinity)){cost.set(next,candidate);previous.set(next,current);if(!open.includes(next))open.push(next);}}
 }
 if(from!==to&&!previous.has(to))return [];
 const chain=[to];while(chain[0]!==from)chain.unshift(previous.get(chain[0])!);
 const route:FloorPoint[]=[];let anchor=start;let i=0;while(i<chain.length){let furthest=i;for(let j=i;j<chain.length;j++){if(segmentIsClear(anchor,point(chain[j])))furthest=j;else break;}anchor=point(chain[furthest]);route.push(anchor);i=furthest+1;}if(segmentIsClear(anchor,end))route.push(end);return route;
}
