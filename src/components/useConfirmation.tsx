import { useEffect,useId,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import { AppButton } from './AppButton';
import './confirmation.css';

export function useConfirmation(){
 const [message,setMessage]=useState<string | null>(null);
 const resolver=useRef<((confirmed:boolean)=>void) | null>(null);
 const dialogRef=useRef<HTMLDivElement>(null);
 const id=useId();
 const close=(confirmed:boolean)=>{resolver.current?.(confirmed);resolver.current=null;setMessage(null);};
 useEffect(()=>()=>{resolver.current?.(false);},[]);
 useEffect(()=>{
  if(!message)return;
  const previous=document.activeElement as HTMLElement | null;
  dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
  const key=(event:KeyboardEvent)=>{
   if(event.key==='Escape')close(false);
   if(event.key==='Tab'){
    const buttons=dialogRef.current?.querySelectorAll<HTMLButtonElement>('button');if(!buttons?.length)return;
    const target=event.shiftKey ? buttons[0] : buttons[buttons.length-1];
    if(document.activeElement===target){event.preventDefault();(event.shiftKey?buttons[buttons.length-1]:buttons[0]).focus();}
   }
  };
  document.addEventListener('keydown',key);
  return()=>{document.removeEventListener('keydown',key);previous?.focus();};
 },[message]);
 const confirm=(text:string)=>new Promise<boolean>(resolve=>{resolver.current?.(false);resolver.current=resolve;setMessage(text);});
 const confirmation=message?createPortal(<div className="confirmation-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)close(false);}}><div ref={dialogRef} className="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby={id+'-title'} aria-describedby={id+'-message'}><h2 id={id+'-title'}>确认删除</h2><p id={id+'-message'}>{message}</p><footer><AppButton onClick={()=>close(false)}>取消</AppButton><AppButton className="confirmation-danger" onClick={()=>close(true)}>确认删除</AppButton></footer></div></div>,document.body):null;
 return {confirm,confirmation};
}
