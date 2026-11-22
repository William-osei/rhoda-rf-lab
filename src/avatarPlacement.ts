import * as THREE from 'three';

/** Fit the existing proportions, then align the feet in world coordinates. */
export function placeAvatarOnGround(model: THREE.Object3D, position: THREE.Vector3, height: number|null = 1.68) {
  model.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(model);
  const currentHeight = bounds.max.y - bounds.min.y;
  if ((height !== null && (!Number.isFinite(height) || height <= 0)) || !Number.isFinite(currentHeight) || currentHeight <= 0 ||
      ![position.x, position.y, position.z].every(Number.isFinite)) return false;
  // The bounding box already contains the current scale; multiplying preserves it.
  if (height !== null) model.scale.multiplyScalar(height / currentHeight);
  model.updateWorldMatrix(true, true);
  bounds.setFromObject(model);
  const target = model.getWorldPosition(new THREE.Vector3());
  target.set(position.x, target.y + position.y - bounds.min.y + .01, position.z);
  if (model.parent) model.parent.worldToLocal(target);
  model.position.copy(target);
  model.updateWorldMatrix(true, true);
  return true;
}
