import type { Object3D, Raycaster } from 'three';

/** A control hidden behind the instrument enclosure must not receive a click. */
export function pickScopeControl(ray:Raycaster, controls:Object3D[], enclosure:Object3D[]) {
  const hit = ray.intersectObjects(controls, false)[0];
  if (!hit) return null;
  const blocker = ray.intersectObjects(enclosure, false)[0];
  return blocker && blocker.distance < hit.distance - 1e-5 ? null : hit;
}
