import * as THREE from 'three';

// Visual details share the primary building/bridge bounds used by navigation
// and Cannon. Bicycles, ripples and moored boats are scenery outside walkways.
export function cityGraphics({world,box,cylinder,mesh,mat,label}) {
  const trim=mat('#e9e4cc',.83),iron=mat('#244c4a',.48,.55),glass=mat('#315262',.25,.3),roof=mat('#4e5858',.8);
  const brickCanvas=document.createElement('canvas');brickCanvas.width=256;brickCanvas.height=256;
  const ctx=brickCanvas.getContext('2d');ctx.fillStyle='#8b857a';ctx.fillRect(0,0,256,256);
  for(let row=0;row<16;row++)for(let col=-1;col<9;col++){ctx.fillStyle=['#c8c1b5','#aaa598','#d6d0c5'][(row+col+9)%3];ctx.fillRect(col*32+(row%2)*16+1,row*16+1,30,14);}
  const brick=new THREE.CanvasTexture(brickCanvas);brick.colorSpace=THREE.SRGBColorSpace;brick.wrapS=brick.wrapT=THREE.RepeatWrapping;brick.repeat.set(3,2);
  function building(o){
    const bounds=box(world,o.size,o.position,new THREE.MeshBasicMaterial({visible:false}));
    const group=new THREE.Group();group.position.set(o.position[0],o.position[1],0);group.rotation.z=Math.PI/2;world.add(group);
    const [x,y]=[0,0],[sx,sy,h]=[o.size[1],o.size[0],o.size[2]],facadeH=h-1.15;
    for(let part=0;part<2;part++){
      const cx=x-sx/4+part*sx/2,w=sx/2-.04;
      const wall=mat(o.color,.9);wall.map=brick;
      box(group,[w,sy,facadeH],[cx,y,facadeH/2],wall);
      for(const side of [-1,1]){
        const yy=y+side*(sy/2+.025);
        box(group,[w,.08,.16],[cx,yy,.2],trim);box(group,[w,.1,.12],[cx,yy,facadeH-.07],trim);
        for(let level=0;level<3;level++)for(const dx of [-.63,.63]){
          const zz=1.25+level*1.65;if(zz+.6>facadeH)continue;
          box(group,[.83,.08,1.2],[cx+dx,yy,zz],trim);box(group,[.69,.09,1.06],[cx+dx,yy+side*.02,zz],glass);
          box(group,[.035,.12,1.1],[cx+dx,yy+side*.06,zz],trim);box(group,[.72,.12,.035],[cx+dx,yy+side*.06,zz+.15],trim);
        }
        box(group,[.65,.12,1.45],[cx,yy+side*.04,.77],iron);box(group,[.73,.13,.08],[cx,yy,1.52],trim);
        // Stepped and neck gables reference the supplied Amsterdam photograph.
        for(let step=0;step<4;step++)box(group,[w*(1-step*.19),.24,.28],[cx,yy,facadeH+.14+step*.27],step===3?trim:wall);
        const sign=label(part===0?'KADE':'GRACHT','#e8dfbf');sign.position.set(cx,yy,.4);sign.scale.set(.5,.25,1);group.add(sign);
      }
      const g=new THREE.BufferGeometry();const a=w/2,b=sy/2,base=facadeH,top=h;
      const v=[-a,-b,base,a,-b,base,0,-b,top,-a,b,base,0,b,top,a,b,base,-a,-b,base,0,-b,top,0,b,top,-a,-b,base,0,b,top,-a,b,base,a,-b,base,a,b,base,0,b,top,a,-b,base,0,b,top,0,-b,top];
      g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));g.computeVertexNormals();mesh(g,roof,group,[cx,y,0]);
      box(group,[.25,.3,.8],[cx+.65,y+.4,h-.15],wall);
    }
    return bounds;
  }
  function water(o){
    const m=box(world,[o.size[0],o.size[1],.06],[o.position[0],o.position[1],.015],mat('#3f7f87',.25,.35));m.castShadow=false;
    for(let k=0;k<Math.floor(o.size[1]*5);k++){const yy=o.position[1]-o.size[1]/2+k*.2;const wave=box(world,[.35+(k%6)*.12,.012,.004],[o.position[0]+Math.sin(k*2.2)*1.1,yy,.05],mat('#8bb5aa',.35));wave.castShadow=false;}
    return m;
  }
  function bridge(o){
    const solid=box(world,o.size,o.position,mat('#c3bfae'));
    for(const side of [-1,1]){
      const yy=o.position[1]+side*(o.size[1]/2-.04);
      for(let x=-o.size[0]/2;x<=o.size[0]/2;x+=.48)cylinder(world,.025,.85,[o.position[0]+x,yy,.475],iron);
      box(world,[o.size[0],.045,.045],[o.position[0],yy,.91],iron);box(world,[o.size[0],.025,.025],[o.position[0],yy,.45],iron);
      box(world,[o.size[0],.12,.18],[o.position[0],yy,.14],mat('#966e59'));
    }return solid;
  }
  function bicycle(x,y,rotation=0){
    const group=new THREE.Group();group.position.set(x,y,0);group.rotation.z=rotation;world.add(group);
    const black=mat('#283c3c',.7),frame=mat('#547e75',.45,.5);
    for(const dx of [-.45,.45]){const wheel=mesh(new THREE.TorusGeometry(.31,.022,6,24),black,group,[dx,0,.34]);wheel.rotation.x=Math.PI/2;}
    const points=[[-.45,0,.34],[-.14,0,.73],[.12,0,.34],[-.45,0,.34],[.26,0,.77],[.45,0,.34],[.12,0,.34],[-.14,0,.73],[.26,0,.77]];
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:'#bfd0a5'})));
    box(group,[.23,.1,.04],[-.15,0,.78],black);box(group,[.03,.33,.03],[.27,0,.85],frame);
  }
  function scenery(){
    // Brick quay edges, a central cobbled lane, bikes and low canal boats.
    for(const side of [-1,1]){
      const canal=box(world,[3.7,120,.02],[side*12.15,0,.004],mat('#3f7f87',.25,.35));canal.castShadow=false;
      for(const [y,len] of [[0,17.6],[-12.6,2.8],[12.6,2.8]])box(world,[.16,len,.14],[side*10.28,y,.035],mat('#9e7860'));
      for(const y of [-8,0,6])bicycle(side*9.75,y,Math.PI/2);
      const boat=new THREE.Group();boat.position.set(side*12.15,side*3,.08);world.add(boat);
      const hull=mesh(new THREE.SphereGeometry(1,20,10),mat(side<0?'#b69749':'#496f6c',.6),boat,[0,0,0]);hull.scale.set(.64,1.9,.22);
      box(boat,[.95,2.9,.1],[0,0,.18],mat('#d4c6a2'));box(boat,[.75,1.3,.5],[0,.3,.45],mat('#ece7d3'));box(boat,[.77,.85,.22],[0,.3,.53],glass);
    }
    for(let y=-13;y<14;y+=1.2)box(world,[.035,.5,.004],[0,y,.012],mat('#d6c9a4'));
    for(const [text,x,y] of [['WEST CANAL',-12,0],['EAST CANAL',12,0],['NARROW ALLEY',-6,1.8],['STAIRS',-1.85,3.3]]){const tag=label(text,'#f0e8cb');tag.position.set(x,y,.2);tag.scale.set(text==='STAIRS'?1.2:2.3,.5,1);world.add(tag);}
  }
  return {building,water,bridge,scenery};
}
