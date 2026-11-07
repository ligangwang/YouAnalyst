"use client";
import {preload} from 'react-dom';

/** The pending feed fetch joins this document preload, including no-store reads. */
export function PreloadIntelligenceFeed({theme}:{theme:string}){
 preload(`/api/intelligence?theme=${theme}&graph=omit&payload=compact`,{as:'fetch',crossOrigin:'anonymous',fetchPriority:'low'});
 return null;
}
