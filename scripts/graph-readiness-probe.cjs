// Shared by the deployment browser and its blank-canvas regression test.
function installGraphReadinessProbe() {
  window.__releaseGraphReadyAt=null;
  window.__releaseFeedReadyAt=null;
  window.__releaseFeedDisabled=false;
  const timer=setInterval(()=>{
    // Scene writes this from useFrame, after async renderer initialization.
    if(window.__releaseGraphReadyAt===null&&document.querySelector('canvas[data-camera-position]')?.getAttribute('data-camera-position')) {
      window.__releaseGraphReadyAt=performance.now();
    }
    // This container mounts only after events/totals leave their pending state,
    // including a valid empty feed. Waiting for a row would hang on quiet days.
    if(window.__releaseFeedReadyAt===null&&document.querySelector('#intelligence-event-stream'))window.__releaseFeedReadyAt=performance.now();
    if(document.querySelector('[data-graph-events=disabled]'))window.__releaseFeedDisabled=true;
    if(window.__releaseGraphReadyAt!==null&&(window.__releaseFeedReadyAt!==null||window.__releaseFeedDisabled))clearInterval(timer);
  },50);
}
module.exports={installGraphReadinessProbe};
