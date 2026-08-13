import { MapPin, MessageCircle, Send, X, Users, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { adminAction } from '../services/adminService';
import { listFarmerSupportMessages, sendFarmerSupportMessage } from '../services/farmerService';
import { subscribeSupportChanges } from '../services/dataService';

const AUTO_REPLY='Your message has been received an agent will accommodate you as soon as possible';
const stamp=(value)=>{try{return new Intl.DateTimeFormat('en-PH',{hour:'numeric',minute:'2-digit'}).format(new Date(value));}catch{return '';}};
const messageId=(row)=>row?.id||row?.$id||`${row?.sender_role||'message'}:${row?.created_at||row?.$createdAt||''}:${row?.message||''}`;
const mergeMessages=(...groups)=>{const map=new Map();for(const row of groups.flat().filter(Boolean)){const id=messageId(row);map.set(id,{...map.get(id),...row,id:row.id||row.$id||id});}return [...map.values()].sort((a,b)=>(Date.parse(a.created_at||a.$createdAt||0)||0)-(Date.parse(b.created_at||b.$createdAt||0)||0));};

function FarmerSupport({user,open,setOpen}){
  const [text,setText]=useState('');
  const [messages,setMessages]=useState([]);
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const mounted=useRef(true);

  const load=async({silent=false}={})=>{
    if(user?.demo)return;
    try{
      const data=await listFarmerSupportMessages({force:true});
      if(mounted.current)setMessages(current=>mergeMessages(current,data?.messages||[]));
      if(!silent&&mounted.current)setNotice('');
    }catch(err){if(!silent&&mounted.current)setNotice(err.message||'Support messages could not be loaded.');}
  };

  useEffect(()=>{mounted.current=true;load();return()=>{mounted.current=false;};},[user?.$id]);
  useEffect(()=>{
    if(user?.demo||!user?.$id)return undefined;
    let cleanup=()=>{};let debounce=null;let fallbackTimer=null;
    const refresh=()=>{clearTimeout(debounce);debounce=setTimeout(()=>load({silent:true}),180);};
    const startFallback=(delay)=>{clearInterval(fallbackTimer);fallbackTimer=setInterval(()=>load({silent:true}),delay);};
    // Realtime handles normal delivery. While the chat panel is open, a 60-second
    // safety refresh is cheap; if Realtime cannot connect, use a 20s fallback.
    startFallback(60000);
    subscribeSupportChanges(user.$id,refresh).then(fn=>{cleanup=fn;}).catch(()=>startFallback(20000));
    return()=>{clearTimeout(debounce);clearInterval(fallbackTimer);Promise.resolve(cleanup?.()).catch(()=>{});};
  },[user?.$id]);

  const send=async(event)=>{
    event?.preventDefault?.();const value=text.trim();if(!value||busy)return;
    if(user?.demo){setMessages(rows=>[...rows,{id:`demo-f-${Date.now()}`,sender_role:'farmer',sender_name:user.name||'You',message:value,created_at:new Date().toISOString()},{id:`demo-s-${Date.now()+1}`,sender_role:'system',sender_name:'SOILS Support',message:AUTO_REPLY,created_at:new Date().toISOString()}]);setText('');return;}
    setBusy(true);setNotice('');
    try{const result=await sendFarmerSupportMessage(value);setMessages(current=>mergeMessages(current,result?.messages||[]));setText('');setTimeout(()=>load({silent:true}),900);}
    catch(err){setNotice(err.message||'Message was not sent.');}
    finally{setBusy(false);}
  };

  return <section className="support-chat-panel" aria-label="SOILS farmer support chat">
    <header><div><span>FARMER SUPPORT</span><b>SOILS Support</b></div><button type="button" onClick={()=>setOpen(false)} aria-label="Close support chat"><X size={15}/></button></header>
    <div className="support-chat-messages">
      {messages.length?messages.map(message=>{const mine=message.sender_role==='farmer';return <div key={message.id||message.$id} className={`support-message ${mine?'farmer':'support'}`}><span>{mine?'You':message.sender_role==='admin'?'Agent':'Support'} {stamp(message.created_at||message.$createdAt)}</span><p>{message.message||message.text}</p></div>}):<div className="support-chat-empty"><MessageCircle size={22}/><b>Need help?</b><span>Send a message. Admin support will receive it.</span></div>}
      {notice&&<div className="support-chat-notice">{notice}</div>}
    </div>
    <form onSubmit={send}><input value={text} onChange={e=>setText(e.target.value)} placeholder="Type your message" aria-label="Support message"/><button type="submit" disabled={!text.trim()||busy}><Send size={15}/><span>{busy?'Sending…':'Send'}</span></button></form>
  </section>;
}

function AdminSupport({open,setOpen,user,onOpenSpatialRequest}){
  const [threads,setThreads]=useState([]);
  const [activeFarmerId,setActiveFarmerId]=useState('');
  const [text,setText]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const messagePaneRef=useRef(null);
  const active=useMemo(()=>threads.find(t=>t.farmer_id===activeFarmerId)||threads[0]||null,[threads,activeFarmerId]);
  const unread=threads.reduce((sum,t)=>sum+Number(t.unread||0),0);
  const visibleMessages=useMemo(()=>active?.messages?.filter(message=>message.sender_role!=='system')||[],[active?.messages]);

  const load=async({silent=false}={})=>{
    if(user?.demo){setThreads([]);return;}
    try{
      const rows=await adminAction('getSupportThreads',{}, {force:true});
      const incoming=Array.isArray(rows)?rows:[];
      setThreads(current=>{
        const previous=new Map(current.map(thread=>[thread.farmer_id,thread]));
        const merged=incoming.map(thread=>{const old=previous.get(thread.farmer_id);return old?{...old,...thread,messages:mergeMessages(old.messages||[],thread.messages||[])}:thread;});
        for(const old of current)if(!merged.some(thread=>thread.farmer_id===old.farmer_id))merged.push(old);
        return merged.sort((a,b)=>(Date.parse(b.last_at||0)||0)-(Date.parse(a.last_at||0)||0));
      });
      setActiveFarmerId(current=>current&&incoming.some(t=>t.farmer_id===current)?current:(incoming[0]?.farmer_id||current||''));
      if(!silent)setNotice('');
    }catch(err){if(!silent)setNotice(err.message||'Support inbox could not be loaded.');}
  };

  useEffect(()=>{load();},[]);
  useEffect(()=>{
    if(user?.demo)return undefined;
    let cleanup=()=>{};let debounce=null;let fallbackTimer=null;
    const refresh=()=>{clearTimeout(debounce);debounce=setTimeout(()=>load({silent:true}),180);};
    const startFallback=(delay)=>{clearInterval(fallbackTimer);fallbackTimer=setInterval(()=>load({silent:true}),delay);};
    startFallback(60000);
    subscribeSupportChanges('',refresh,{admin:true}).then(fn=>{cleanup=fn;}).catch(()=>startFallback(20000));
    return()=>{clearTimeout(debounce);clearInterval(fallbackTimer);Promise.resolve(cleanup?.()).catch(()=>{});};
  },[user?.$id]);
  useEffect(()=>{
    if(!open||!active?.farmer_id||!active.unread)return;
    adminAction('markSupportThreadRead',{farmer_id:active.farmer_id}).then(()=>load({silent:true})).catch(()=>{});
  },[open,active?.farmer_id,active?.unread]);

  useEffect(()=>{
    if(!open)return;
    const pane=messagePaneRef.current;
    if(!pane)return;
    requestAnimationFrame(()=>pane.scrollTo({top:pane.scrollHeight,behavior:'smooth'}));
  },[open,active?.farmer_id,visibleMessages.length]);

  const send=async(event)=>{
    event?.preventDefault?.();const value=text.trim();if(!value||!active||busy)return;
    setBusy(true);setNotice('');
    try{
      const result=await adminAction('adminSendSupportReply',{farmer_id:active.farmer_id,farm_id:active.farm_id,message:value});
      const message=result?.message;
      if(message)setThreads(rows=>rows.map(thread=>thread.farmer_id===active.farmer_id?{...thread,last_message:message.message,last_at:message.created_at||message.$createdAt,messages:mergeMessages(thread.messages||[],[message])}:thread));
      setText('');setTimeout(()=>load({silent:true}),900);
    }
    catch(err){setNotice(err.message||'Reply was not sent.');}
    finally{setBusy(false);}
  };

  return <section className="support-chat-panel admin-support-panel" aria-label="SOILS admin support inbox">
    <header><div><span>ADMIN SUPPORT INBOX</span><b>Farmer messages {unread>0?`• ${unread} unread`:''}</b></div><div className="support-head-actions"><button type="button" onClick={()=>load()} aria-label="Refresh support"><RefreshCw size={14}/></button><button type="button" onClick={()=>setOpen(false)} aria-label="Close support chat"><X size={15}/></button></div></header>
    <div className="admin-support-body">
      <aside className="support-thread-list">
        {threads.length?threads.map(thread=><button type="button" key={thread.farmer_id} className={thread.farmer_id===active?.farmer_id?'active':''} onClick={()=>setActiveFarmerId(thread.farmer_id)}><div><b>{thread.farmer_name||'Farmer'}</b><span>{thread.farm_name||'Assigned farm'}</span></div>{thread.unread>0&&<strong>{thread.unread}</strong>}<p>{thread.last_message}</p></button>):<div className="support-chat-empty"><Users size={22}/><b>No conversations yet</b><span>Farmer messages will appear here.</span></div>}
      </aside>
      <div className="support-conversation">
        <div className="support-conversation-head">
          <div><span>ACTIVE THREAD</span><b>{active?.farmer_name||'Select a Farmer'}</b></div>
          {active&&<small>{active.farm_name||'Assigned farm'}</small>}
        </div>
        <div className="support-chat-messages" ref={messagePaneRef}>
          {visibleMessages.length?visibleMessages.map(message=>{const farmer=message.sender_role==='farmer';const request=message.request;return <div key={message.id||message.$id} className={`support-message ${farmer?'support':'farmer'} ${request?'has-map-request':''}`}><span>{farmer?(message.sender_name||active.farmer_name):'You'} {stamp(message.created_at||message.$createdAt)}</span>{request?<button type="button" className="support-map-request-card" onClick={()=>{onOpenSpatialRequest?.(request);setOpen(false)}}><MapPin size={16}/><div><b>{request.title||'Farmer map request'}</b><span>{request.request_type==='sensor'?'Sensor':request.request_type==='plot'?'Soil Plot':'Drone Mapping'} • {String(request.status||'pending').toUpperCase()}</span><p>{message.message}</p></div><strong>Open map</strong></button>:<p>{message.message}</p>}</div>}):<div className="support-chat-empty"><MessageCircle size={22}/><b>{active?'No direct messages yet':'Select a Farmer'}</b><span>{active?'Automatic acknowledgements are hidden from the Admin inbox.':'Open a support thread to reply.'}</span></div>}
          {notice&&<div className="support-chat-notice">{notice}</div>}
        </div>
        <form onSubmit={send}><input value={text} onChange={e=>setText(e.target.value)} placeholder={active?`Reply to ${active.farmer_name}`:'Choose a Farmer conversation'} disabled={!active} aria-label="Admin support reply"/><button type="submit" disabled={!active||!text.trim()||busy}><Send size={15}/><span>{busy?'Sending…':'Reply'}</span></button></form>
      </div>
    </div>
  </section>;
}

export default function SupportChat({user,admin=false,onOpenSpatialRequest}){
  const [open,setOpen]=useState(false);
  return <div className={`support-chat ${open?'open':''} ${admin?'is-admin':''}`}>
    {open&&(admin?<AdminSupport open={open} setOpen={setOpen} user={user} onOpenSpatialRequest={onOpenSpatialRequest}/>:<FarmerSupport user={user} open={open} setOpen={setOpen}/>)}
    <button type="button" className="support-chat-launcher" onClick={()=>setOpen(v=>!v)} aria-label={open?'Close support chat':'Open support chat'}><MessageCircle size={18}/><span>{admin?'Support inbox':'Support'}</span></button>
  </div>;
}
