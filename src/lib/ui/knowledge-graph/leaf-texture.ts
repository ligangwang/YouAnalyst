import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { verticalJitter as jitter } from './vertical-tree';

// A twig carrying alternate, veined leaves, painted once into an alpha cut-out.
// Canopy cards tint it per instance, so a few hundred cards read as thousands of
// individually shaped leaves. The leaves are painted pale so the tint sets the hue.
type Context=CanvasRenderingContext2D;

function paintLeaf(g:Context,length:number,width:number,seed:string,scale:number){
  const outline=new Path2D();
  outline.moveTo(0,0);
  outline.bezierCurveTo(length*.22,-width*.64,length*.72,-width*.52,length,0);
  outline.bezierCurveTo(length*.72,width*.52,length*.22,width*.64,0,0);
  const light=jitter(seed,1)*.12;
  // Light falls across the blade: the upper half catches it, the lower half turns away.
  const blade=g.createLinearGradient(0,-width/2,0,width/2);
  blade.addColorStop(0,`hsl(${78+jitter(seed,2)*14} 52% ${80+light*60}%)`);
  blade.addColorStop(.48,`hsl(${84+jitter(seed,3)*12} 46% ${70+light*60}%)`);
  blade.addColorStop(1,`hsl(${92+jitter(seed,4)*10} 42% ${56+light*60}%)`);
  g.fillStyle=blade;g.fill(outline);
  g.save();g.clip(outline);
  // Paler near the stalk, deeper towards the tip.
  const along=g.createLinearGradient(0,0,length,0);
  along.addColorStop(0,'rgba(255,255,230,.18)');along.addColorStop(1,'rgba(30,60,10,.16)');
  g.fillStyle=along;g.fillRect(0,-width,length,width*2);
  g.lineCap='round';
  g.strokeStyle='rgba(250,255,225,.75)';g.lineWidth=2.6*scale;
  g.beginPath();g.moveTo(0,0);g.quadraticCurveTo(length*.5,-width*.05,length*.97,0);g.stroke();
  g.strokeStyle='rgba(248,255,222,.42)';g.lineWidth=1.1*scale;
  for(let k=1;k<=7;k++){
    const x=length*k/8.4,reach=width*.46*Math.sin(Math.PI*Math.min(.98,x/length+.08));
    for(const side of [-1,1]){
      g.beginPath();g.moveTo(x,side*1.2*scale);
      g.quadraticCurveTo(x+length*.06,side*reach*.35,x+length*.15,side*reach);g.stroke();
    }
  }
  // Fine mottling so the blades are not flat fills.
  for(let i=0;i<90;i++){
    const r=jitter(seed,10+i);
    g.fillStyle=r>.5?'rgba(255,255,235,.10)':'rgba(25,55,10,.10)';
    g.beginPath();g.arc(jitter(seed,200+i)*length,(jitter(seed,400+i)-.5)*width,(.8+r*2.2)*scale,0,Math.PI*2);g.fill();
  }
  g.restore();
  g.strokeStyle='rgba(45,75,22,.55)';g.lineWidth=1.4*scale;g.stroke(outline);
}

export function leafClusterTexture(size=512){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const g=canvas.getContext('2d');if(!g)return null;
  const scale=size/512;
  // The twig enters at the bottom centre (the card's anchor) and bends towards the tip.
  const twig=(t:number):[number,number]=>[size*(.5+.07*Math.sin(t*2.4)*t),size*(.98-.84*t)];
  g.lineCap='round';g.strokeStyle='#7a6542';
  for(let i=0;i<24;i++){
    const [ax,ay]=twig(i/24),[bx,by]=twig((i+1)/24);
    g.lineWidth=(7-4.5*i/24)*scale;g.beginPath();g.moveTo(ax,ay);g.lineTo(bx,by);g.stroke();
  }
  const leaves=[...Array.from({length:6},(_,i)=>({t:.16+i*.14,side:i%2?1:-1})),{t:1,side:0}];
  for(const [i,{t,side}] of leaves.entries()){
    const [x,y]=twig(t),seed=`leaf${i}`;
    const length=(side?205-14*i:170)*scale*(.92+.16*jitter(seed,5)),width=length*.44;
    const angle=side?-Math.PI/2+side*(1.05-.07*i+(jitter(seed,6)-.5)*.2):-Math.PI/2+.12;
    const stalk=(side?16:6)*scale;
    g.save();g.translate(x,y);g.rotate(angle);
    g.strokeStyle='#8a7a46';g.lineWidth=2.4*scale;g.beginPath();g.moveTo(0,0);g.lineTo(stalk,0);g.stroke();
    g.translate(stalk,0);
    paintLeaf(g,length,width,seed,scale);
    g.restore();
  }
  const texture=new CanvasTexture(canvas);
  texture.colorSpace=SRGBColorSpace;texture.anisotropy=4;
  return texture;
}

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
