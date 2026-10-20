import type { Map } from 'maplibre-gl';

// Local canvas sprites avoid external fonts, icon services and image loading races.
export function addVesselIcons(map:Map) {
  for(const portfolio of [false,true])for(const oriented of [true,false]){
    const canvas=document.createElement('canvas');canvas.width=48;canvas.height=64;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Vessel icons could not be initialized.');
    ctx.fillStyle=portfolio?'#287d69':'#2674bb';ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.lineJoin='round';
    ctx.beginPath();
    if(oriented){
      // Bow points north in the sprite; MapLibre rotates it by reported course.
      ctx.moveTo(24,5);ctx.lineTo(37,23);ctx.lineTo(34,55);ctx.lineTo(14,55);ctx.lineTo(11,23);
      ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle='#fff';ctx.fillRect(18,31,12,7);ctx.fillRect(21,43,6,5);
    }else{
      // Side-on ship silhouette conveys a vessel without asserting a bearing.
      ctx.moveTo(5,35);ctx.lineTo(43,35);ctx.lineTo(35,49);ctx.lineTo(14,49);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillRect(15,24,18,11);ctx.strokeRect(15,24,18,11);ctx.fillRect(26,17,5,7);
    }
    map.addImage(`monitor-vessel${portfolio?'-portfolio':''}${oriented?'':'-unknown'}`,ctx.getImageData(0,0,48,64),{pixelRatio:2});
  }
}
