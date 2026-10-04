"use client";

import {useEffect} from 'react';
import {useThree} from '@react-three/fiber';

export function WebGLContextRecovery({onLost}:{onLost:(lost:boolean)=>void}) {
  const {gl,invalidate}=useThree();
  useEffect(()=>{
    const canvas=gl.domElement;
    const lost=(event:Event)=>{event.preventDefault();onLost(true);};
    const restored=()=>{onLost(false);invalidate();};
    canvas.addEventListener('webglcontextlost',lost);
    canvas.addEventListener('webglcontextrestored',restored);
    return ()=>{
      canvas.removeEventListener('webglcontextlost',lost);
      canvas.removeEventListener('webglcontextrestored',restored);
    };
  },[gl,invalidate,onLost]);
  return null;
}
