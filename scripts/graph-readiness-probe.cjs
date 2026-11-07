// Shared by the deployment browser and its blank-canvas regression test.
function installGraphReadinessProbe() {
  window.__releaseGraphReadyAt=null;
  const timer=setInterval(()=>{
    // Scene writes this from useFrame, after async renderer initialization.
    if(document.querySelector('canvas[data-camera-position]')?.getAttribute('data-camera-position')) {
      window.__releaseGraphReadyAt=performance.now();clearInterval(timer);
    }
  },50);
}
module.exports={installGraphReadinessProbe};
