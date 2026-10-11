export const LABEL_FADE_MS = 1200;
export const LABEL_CLEAR_MS = 220;
export type LabelFade = { level:number; visible:boolean; clearSince:number|null; last:number };
export function createLabelFade(now:number):LabelFade {
  return {level:0,visible:false,clearSince:null,last:now};
}

// Finish an exit before allowing a label back; brief collision gaps must not flash names.
export function advanceLabelFade(state:LabelFade, wanted:boolean, now:number, reduced=false){
  let elapsed=Math.max(0,now-state.last);state.last=now;
  if(reduced){state.level=wanted?1:0;state.visible=wanted;state.clearSince=null;}
  else {
    if(!wanted){if(state.visible)elapsed=0;state.visible=false;state.clearSince=null;}
    else if(!state.visible&&state.level===0){
      state.clearSince??=now;
      if(now-state.clearSince>=LABEL_CLEAR_MS){state.visible=true;state.clearSince=null;elapsed=0;}
    }
    state.level=Math.max(0,Math.min(1,state.level+(state.visible?1:-1)*elapsed/LABEL_FADE_MS));
  }
  return {opacity:state.level*state.level*(3-2*state.level),moving:state.level!==(state.visible?1:0)||(wanted&&!state.visible)};
}
