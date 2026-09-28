import { Vector3 } from "three";

// Fit the actual projected neighborhood instead of a sphere around its farthest node.
export function fitSelectionCamera(points: {x:number;y:number;z:number}[], direction: Vector3, width: number, height: number, ballRadius: number, fov = 45) {
  const backward = direction.clone().normalize();
  const right = new Vector3().crossVectors(new Vector3(0,1,0), backward);
  if (right.lengthSq() < 1e-8) right.set(1,0,0);
  right.normalize();
  const up = new Vector3().crossVectors(backward, right).normalize();
  const projected = points.map(p => {
    const v = new Vector3(p.x,p.y,p.z);
    return {x:v.dot(right), y:v.dot(up), z:v.dot(backward)};
  });
  const middle = (axis: 'x'|'y'|'z') => (Math.min(...projected.map(p=>p[axis])) + Math.max(...projected.map(p=>p[axis]))) / 2;
  const x=middle('x'), y=middle('y'), z=middle('z');
  const target = right.clone().multiplyScalar(x).addScaledVector(up,y).addScaledVector(backward,z);
  // Leave room for labels, with smaller margins on narrow viewports.
  const tanY = Math.tan(fov*Math.PI/360);
  const tanX = tanY*width/height;
  const usableX = Math.max(.5,1-2*Math.min(110,width*.15)/width);
  const usableY = Math.max(.5,1-2*Math.min(65,height*.15)/height);
  let distance = Math.max(1,...projected.map(p => p.z-z+Math.max(Math.abs(p.x-x)/(tanX*usableX),Math.abs(p.y-y)/(tanY*usableY))));
  // Stay outside the ball without changing the viewing direction or fitted bounds.
  const along = target.dot(backward);
  const discriminant = along*along + (ballRadius*1.15)**2 - target.lengthSq();
  if (discriminant >= 0) distance = Math.max(distance,-along+Math.sqrt(discriminant));
  return {target, position:target.clone().addScaledVector(backward,distance)};
}
