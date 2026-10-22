import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { verticalJitter as jitter } from './vertical-tree';

// Surface detail for a company leaf. The blade geometry maps u along its length
// and v across its width, so veins painted in this square follow its outline.
export function leafBladeTexture(width=512,height=256){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const g=canvas.getContext('2d');if(!g)return null;
  const mid=height/2;
  const across=g.createLinearGradient(0,0,0,height);
  across.addColorStop(0,'#c9d9a6');across.addColorStop(.3,'#eef6d6');across.addColorStop(.5,'#f4f9e4');
  across.addColorStop(.7,'#e2edc4');across.addColorStop(1,'#b8cb92');
  g.fillStyle=across;g.fillRect(0,0,width,height);
  for(let i=0;i<260;i++){
    const r=jitter('blade',i);
    g.fillStyle=r>.5?'rgba(255,255,240,.12)':'rgba(40,70,20,.08)';
    g.beginPath();g.arc(jitter('blade',300+i)*width,jitter('blade',600+i)*height,1+r*3,0,Math.PI*2);g.fill();
  }
  g.lineCap='round';
  g.strokeStyle='rgba(255,255,236,.6)';g.lineWidth=2.2;
  for(let k=1;k<=9;k++){
    const x=width*(k/10.5);
    for(const side of [-1,1]){
      g.beginPath();g.moveTo(x,mid);g.quadraticCurveTo(x+width*.05,mid+side*height*.18,x+width*.12,mid+side*height*.47);g.stroke();
    }
  }
  const rib=g.createLinearGradient(0,0,width,0);
  rib.addColorStop(0,'rgba(255,255,236,.95)');rib.addColorStop(1,'rgba(255,255,236,.4)');
  g.strokeStyle=rib;g.lineWidth=6;g.beginPath();g.moveTo(0,mid);g.lineTo(width*.97,mid);g.stroke();
  const texture=new CanvasTexture(canvas);
  texture.colorSpace=SRGBColorSpace;texture.anisotropy=4;
  return texture;
}

// A seamless patch of short grass and soil flecks, tiled across the meadow and
// tinted by the terrain's own colour variation.
export function meadowTexture(size=512){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const g=canvas.getContext('2d');if(!g)return null;
  g.fillStyle='#d9e3bf';g.fillRect(0,0,size,size);
  // Draw near-edge marks on the opposite edge too, so the tile has no seams.
  const wrapped=(draw:(dx:number,dy:number)=>void,x:number,y:number,reach:number)=>{
    const xs=[0,x<reach?size:x>size-reach?-size:0],ys=[0,y<reach?size:y>size-reach?-size:0];
    for(const [i,dx] of xs.entries())for(const [j,dy] of ys.entries())if((i===0||dx)&&(j===0||dy))draw(dx,dy);
  };
  for(let i=0;i<220;i++){
    const x=jitter('soil',i)*size,y=jitter('soil',300+i)*size,r=2+jitter('soil',600+i)*5;
    g.fillStyle=`rgba(${110+jitter('soil',900+i)*40|0},${92+jitter('soil',1200+i)*30|0},58,.22)`;
    wrapped((dx,dy)=>{g.beginPath();g.arc(x+dx,y+dy,r,0,Math.PI*2);g.fill();},x,y,r);
  }
  g.lineCap='round';
  for(let i=0;i<5200;i++){
    const x=jitter('blade-mark',i)*size,y=jitter('blade-mark',7000+i)*size,shade=jitter('blade-mark',14000+i);
    const length=5+jitter('blade-mark',21000+i)*13,lean=(jitter('blade-mark',28000+i)-.5)*.9;
    g.strokeStyle=shade>.55?`rgba(250,255,225,${.25+shade*.3})`:`rgba(70,105,35,${.18+shade*.3})`;
    g.lineWidth=1+shade*1.2;
    wrapped((dx,dy)=>{g.beginPath();g.moveTo(x+dx,y+dy);g.lineTo(x+dx+Math.sin(lean)*length,y+dy-Math.cos(lean)*length);g.stroke();},x,y,length);
  }
  const texture=new CanvasTexture(canvas);
  texture.colorSpace=SRGBColorSpace;texture.anisotropy=8;texture.wrapS=texture.wrapT=RepeatWrapping;
  return texture;
}
