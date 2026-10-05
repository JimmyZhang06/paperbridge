import { useEffect,useState } from 'react';
import { AppButton } from '../../components/AppButton';
type Crop=[number,number,number,number];
export function FigureCropEditor({initial,onChange,onSave}:{initial:Crop;onChange:(crop:Crop)=>void;onSave:(crop:Crop)=>Promise<void>}){
  const [crop,setCrop]=useState<Crop>(initial);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>setCrop(initial),[initial]);
  const update=(index:number,value:number)=>{const next=[...crop] as Crop;next[index]=value/100;next[0]=Math.max(0,Math.min(next[0],.99));next[1]=Math.max(0,Math.min(next[1],.99));next[2]=Math.max(.01,Math.min(next[2],1-next[0]));next[3]=Math.max(.01,Math.min(next[3],1-next[1]));setCrop(next);onChange(next);};
  return <div className="figure-crop-editor">{['左侧位置','顶部位置','宽度','高度'].map((label,index)=><label key={label}><span>{label} · {Math.round(crop[index]*100)}%</span><input type="range" min={index<2?0:1} max="100" value={crop[index]*100} onChange={event=>update(index,Number(event.target.value))}/></label>)}
    <AppButton disabled={busy} onClick={()=>{setBusy(true);setError('');void onSave(crop).catch(error=>setError(error.message)).finally(()=>setBusy(false));}}>{busy?'保存中…':'保存图表范围'}</AppButton>{error&&<p role="alert">{error}</p>}</div>;
}
