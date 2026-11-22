export type InspectionBounds={minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number};
export type InspectionViewport={width:number;height:number;top:number;bottom:number};

/** Raise a level arrival view only when the visible top would hit the header.
 * X/Z and the walking endpoint remain outside this calculation's ownership.
 */
export function arrivalClearanceHeight(bounds:InspectionBounds,camera:{x:number;z:number},target:{x:number;z:number},viewport:{height:number;top:number},fov:number,zoom:number,minimumHeight:number,immersive=false){
 if(immersive)return null;
 if(![...Object.values(bounds),camera.x,camera.z,target.x,target.z,viewport.height,viewport.top,minimumHeight].every(Number.isFinite)||viewport.height<=0)return null;
 const length=Math.hypot(target.x-camera.x,target.z-camera.z);
 if(length<.01)return minimumHeight;
 const dx=(target.x-camera.x)/length,dz=(target.z-camera.z)/length;
 const upper=1-2*Math.max(0,Math.min(viewport.height-1,viewport.top))/viewport.height;
 const tangent=Math.tan((Number.isFinite(fov)?Math.max(1,Math.min(175,fov)):50)*Math.PI/360)/(Number.isFinite(zoom)&&zoom>0?zoom:1);
 let height=minimumHeight;
 for(const x of [bounds.minX,bounds.maxX])for(const z of [bounds.minZ,bounds.maxZ]){
  const depth=(x-camera.x)*dx+(z-camera.z)*dz;
  if(depth>.01)height=Math.max(height,bounds.maxY-upper*depth*tangent+.005);
 }
 return height;
}

/** Fit a level desktop camera to an unobstructed vertical canvas region.
 * Bounds are relative to the model's Z anchor; its position is never changed.
 */
export function fitDesktopInspection(bounds:InspectionBounds,viewport:InspectionViewport,fov:number,zoom:number,minimumDistance:number,immersive=false){
 if(immersive)return null;
 if(!Object.values(bounds).every(Number.isFinite)||!Object.values(viewport).every(Number.isFinite)||viewport.width<=0||viewport.height<=0||bounds.maxY<=bounds.minY)return null;
 const top=Math.max(0,Math.min(viewport.height-1,viewport.top));
 const bottom=Math.min(viewport.height,Math.max(top+1,viewport.bottom));
 const upper=1-2*top/viewport.height,lower=1-2*bottom/viewport.height;
 const tangent=Math.tan((Number.isFinite(fov)?Math.max(1,Math.min(175,fov)):50)*Math.PI/360)/(Number.isFinite(zoom)&&zoom>0?zoom:1);
 const aspect=viewport.width/viewport.height,z=[bounds.minZ,bounds.maxZ];
 let distance=Math.max(minimumDistance,bounds.maxZ+.1);
 // Pair every upper/lower depth corner. This also handles a usable region
 // below the canvas center, where a near/far pair can be the limiting pair.
 for(const upperZ of z)for(const lowerZ of z){
  distance=Math.max(distance,(bounds.maxY-bounds.minY)/(tangent*(upper-lower))+(upper*upperZ-lower*lowerZ)/(upper-lower));
 }
 const horizontalMargin=Math.min(.2,16/viewport.width),horizontalNdc=1-2*horizontalMargin;
 distance=Math.max(distance,(bounds.maxX-bounds.minX)/(2*tangent*aspect*horizontalNdc)+bounds.maxZ);
 distance+=.01;
 const lowestCameraY=Math.max(...z.map(depth=>bounds.maxY-upper*(distance-depth)*tangent));
 const highestCameraY=Math.min(...z.map(depth=>bounds.minY-lower*(distance-depth)*tangent));
 return {x:(bounds.minX+bounds.maxX)/2,y:(lowestCameraY+highestCameraY)/2,distance};
}
