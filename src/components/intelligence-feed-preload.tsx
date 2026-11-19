"use client";
import {preload} from 'react-dom';

/** The pending feed fetch joins this document preload, including no-store reads. */
export function PreloadIntelligenceFeed({theme,includeGraph=false}:{theme:string;includeGraph?:boolean}){
 preload(`/api/intelligence?theme=${theme}&graph=${includeGraph?'compact':'omit'}&payload=compact`,{as:'fetch',crossOrigin:'anonymous',fetchPriority:'low'});
 return null;
}
