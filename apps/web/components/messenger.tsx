"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowLeft,
  Check,
  Edit3,
  File,
  Image as ImageIcon,
  Info,
  LogOut,
  MessageCircle,
  Mic,
  Moon,
  Paperclip,
  Phone,
  Plus,
  Reply,
  Search,
  Send,
  Smile,
  Sun,
  Trash2,
  VolumeX,
  WifiOff,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { io, Socket } from "socket.io-client";
import { API, api, AUTH_EVENT, clearSession, getAccessToken, getRefreshToken, refreshSession } from "@/lib/api";
import { uploadFile, validateUpload } from "@/lib/uploads";
import {
  AttachmentPreview,
  AvatarUploader,
  ImageViewer,
  MessageMedia,
} from "./media-ui";
import { GroupManagement, GroupMember } from "./group-management";
import { PushNotifications } from "./push-notifications";
import { VoicePanel } from "./voice-panel";
import { NewChatDialog } from "./new-chat-dialog";
type User = {
  id: string;
  displayName: string;
  username: string;
  avatarUrl?: string;
  online?: boolean;
};
type Reaction = { emoji: string; userId: string };
type Message = {
  id: string;
  chatId: string;
  body: string;
  kind?: "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "SYSTEM";
  author: User;
  authorId: string;
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
  replyTo?: Message;
  reactions: Reaction[];
  mediaUrl?: string;
  mediaName?: string;
  mediaType?: string;
  mediaSize?: number;
};
type Chat = {
  id: string;
  type: "DIRECT" | "GROUP";
  title?: string;
  avatarUrl?: string;
  members: GroupMember[];
  messages: Message[];
  unreadCount?: number;
};
function avatar(name: string, online = false, url?: string) {
  return (
    <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-indigo-400 to-violet-600 text-lg font-bold text-white">
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        name[0]
      )}
      {online && (
        <i className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-400 dark:border-slate-900" />
      )}
    </span>
  );
}
function title(c: Chat, me: string) {
  return (
    c.title ??
    c.members.find((x) => x.user.id !== me)?.user.displayName ??
    "Личный чат"
  );
}
function chatOnline(chat:Chat,me:string){return chat.members.some((member)=>member.user.id!==me&&member.user.online)}
function listTime(value?:string){
  if(!value)return"";const date=new Date(value);if(Number.isNaN(date.getTime()))return"";
  const today=new Date();return date.toDateString()===today.toDateString()?date.toLocaleTimeString("ru",{hour:"2-digit",minute:"2-digit"}):date.toLocaleDateString("ru",{day:"2-digit",month:"2-digit"});
}
export function Messenger() {
  const { theme, setTheme } = useTheme();
  const [me, setMe] = useState<User>({
    id: "",
    displayName: "Пользователь",
    username: "",
  });
  const [chats, setChats] = useState<Chat[]>([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [activeId, setActiveId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [mobileChat, setMobileChat] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [typing, setTyping] = useState(false);
  const [voice, setVoice] = useState<{ token: string; url: string; chatId:string } | null>(
    null,
  );
  const [attachment, setAttachment] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [viewer, setViewer] = useState<{ url: string; name: string } | null>(
    null,
  );
  const [toast, setToast] = useState("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [wideLayout,setWideLayout]=useState(false);
  const [connectionLost,setConnectionLost]=useState(false);
  const [chatFilter,setChatFilter]=useState<"ALL"|"DIRECT"|"GROUP">("ALL");
  const [chatSearch,setChatSearch]=useState("");
  const [loadingOlder,setLoadingOlder]=useState(false);
  const [hasOlder,setHasOlder]=useState(false);
  const [activeActions,setActiveActions]=useState<string|null>(null);
  const uploadController = useRef<AbortController | null>(null);
  const voiceRef = useRef<typeof voice>(null);
  const leavingVoice = useRef(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const socket = useRef<Socket | null>(null);
  const messageList=useRef<HTMLDivElement|null>(null);
  const activeIdRef=useRef(activeId);
  const mobileChatRef=useRef(mobileChat);
  const meIdRef=useRef(me.id);
  const messagesRef=useRef(messages);
  const actionTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const active = chats.find((c) => c.id === activeId) ?? chats[0];
  const ownMembership = active?.members.find(
    (member) => member.user.id === me.id,
  );
  const muted = Boolean(
    ownMembership?.isMuted &&
      (!ownMembership.mutedUntil ||
        new Date(ownMembership.mutedUntil) > new Date()),
  );
  const visibleChats=chats.filter((chat)=>(chatFilter==="ALL"||chat.type===chatFilter)&&title(chat,me.id).toLocaleLowerCase("ru").includes(chatSearch.trim().toLocaleLowerCase("ru")));
  useEffect(()=>{activeIdRef.current=activeId},[activeId]);
  useEffect(()=>{mobileChatRef.current=mobileChat},[mobileChat]);
  useEffect(()=>{meIdRef.current=me.id},[me.id]);
  useEffect(()=>{messagesRef.current=messages},[messages]);
  useEffect(()=>{voiceRef.current=voice},[voice]);
  useEffect(()=>{const media=window.matchMedia("(min-width:1280px)");const update=()=>setWideLayout(media.matches);update();media.addEventListener("change",update);return()=>media.removeEventListener("change",update)},[]);
  useEffect(()=>{
    const unload=()=>{
      const current=voiceRef.current;const token=getAccessToken();
      if(current&&token)void fetch(`${API}/api/voice/${current.chatId}/leave`,{method:"POST",headers:{Authorization:`Bearer ${token}`},keepalive:true});
    };
    window.addEventListener("beforeunload",unload);
    return()=>window.removeEventListener("beforeunload",unload);
  },[]);
  async function reloadChats(){
    const cs=await api<Chat[]>("/chats");
    setChats(cs);setActiveId((current)=>cs.some((chat)=>chat.id===current)?current:(cs[0]?.id??""));
  }
  async function reloadMessages(chatId:string){
    const page=await api<Message[]>(`/chats/${chatId}/messages`);
    if(activeIdRef.current!==chatId)return;
    setMessages(page.reverse());setHasOlder(page.length===50);
    setChats((items)=>items.map((chat)=>chat.id===chatId?{...chat,unreadCount:0}:chat));
    await api(`/chats/${chatId}/read`,{method:"POST"});
  }
  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js");
    const token = getAccessToken();
    if (!token) return;
    api<User>("/auth/me")
      .then(setMe)
      .catch(() => {});
    reloadChats()
      .catch(() => {})
      .finally(() => setChatsLoaded(true));
    const client = io(
      `${process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:4000"}/chat`,
      { auth: { token } },
    );
    socket.current = client;
    const updateSocketAuth = () => {
      client.auth = { token: getAccessToken() ?? "" };
    };
    const reconnectWithRefresh = async (error: Error) => {
      if (error.message !== "unauthorized") return;
      const refreshed = await refreshSession();
      if (refreshed) {
        client.auth = { token: refreshed };
        client.connect();
      }
    };
    window.addEventListener(AUTH_EVENT, updateSocketAuth);
    client.io.on("reconnect_attempt", updateSocketAuth);
    client.on("connect_error", reconnectWithRefresh);
    let connectedBefore=false;
    const visibility = () => {
      const chatId=activeIdRef.current;if(!chatId)return;
      const desktop=window.matchMedia("(min-width: 768px)");
      const chatIsOpen=document.visibilityState==="visible"&&(mobileChatRef.current||desktop.matches);
      client.emit(chatIsOpen?"chat:join":"chat:leave",{chatId});
    };
    const connected=()=>{
      setConnectionLost(false);visibility();
      if(connectedBefore){
        void reloadChats().catch(()=>{});
        const chatId=activeIdRef.current;if(chatId)void reloadMessages(chatId).catch(()=>{});
      }
      connectedBefore=true;
    };
    const disconnected=()=>setConnectionLost(true);
    const browserOffline=()=>{
      setConnectionLost(true);
      client.disconnect();
    };
    const browserOnline=()=>{
      updateSocketAuth();
      client.connect();
    };
    client.on("connect",connected);
    client.on("disconnect",disconnected);
    window.addEventListener("offline",browserOffline);
    window.addEventListener("online",browserOnline);
    socket.current.on("message:new", (m: Message) => {
      const desktop = window.matchMedia("(min-width: 768px)").matches;
      const visible = document.visibilityState === "visible" && (mobileChatRef.current || desktop);
      if (m.chatId === activeIdRef.current) {
        setMessages((x) => (x.some((v) => v.id === m.id) ? x : [...x, m]));
        if (visible) void api(`/chats/${m.chatId}/read`, { method: "POST" });
      }
      setChats((items) => items.map((chat) => chat.id === m.chatId ? {
        ...chat,
        messages:[m],
        unreadCount:m.authorId !== meIdRef.current && !(m.chatId === activeIdRef.current && visible) ? (chat.unreadCount ?? 0) + 1 : 0,
      } : chat));
    });
    socket.current.on("presence:update", (event: {userId:string;online:boolean}) =>
      setChats((items)=>items.map((chat)=>({...chat,members:chat.members.map((member)=>member.user.id===event.userId?{...member,user:{...member.user,online:event.online}}:member)}))),
    );
    socket.current.on("message:reaction", (event:{messageId:string;reactions:Reaction[]}) =>
      setMessages((items)=>items.map((message)=>message.id===event.messageId?{...message,reactions:event.reactions}:message)),
    );
    socket.current.on("message:edited",(event:{message:Message})=>setMessages((items)=>items.map((message)=>message.id===event.message.id?event.message:message)));
    socket.current.on("message:deleted",(event:{message:Message})=>setMessages((items)=>items.map((message)=>message.id===event.message.id?event.message:message)));
    socket.current.on("chat:updated", (event:{chatId:string;chat:Partial<Chat>}) =>
      setChats((items)=>items.map((chat)=>chat.id===event.chatId?{...chat,...event.chat}:chat)),
    );
    socket.current.on("chat:created",(chat:Chat)=>setChats((items)=>items.some((item)=>item.id===chat.id)?items:[{...chat,messages:chat.messages??[],unreadCount:0},...items]));
    socket.current.on("typing:update", (d: any) => {
      if (d.chatId === activeIdRef.current) setTyping(d.typing);
    });
    socket.current.on(
      "chat:member-updated",
      (event: { chatId: string; member: GroupMember }) => {
        setChats((items) =>
          items.map((chat) =>
            chat.id !== event.chatId
              ? chat
              : {
                  ...chat,
                  members: chat.members.some(
                    (member) => member.user.id === event.member.user.id,
                  )
                    ? chat.members.map((member) =>
                        member.user.id === event.member.user.id
                          ? event.member
                          : member,
                      )
                    : [...chat.members, event.member],
                },
          ),
        );
        setMessages((items)=>items.map((message)=>message.authorId===event.member.user.id?{...message,author:{...message.author,...event.member.user}}:message));
      },
    );
    socket.current.on(
      "chat:member-removed",
      (event: { chatId: string; userId: string }) =>
        setChats((items) =>
          items.map((chat) =>
            chat.id === event.chatId
              ? {
                  ...chat,
                  members: chat.members.filter(
                    (member) => member.user.id !== event.userId,
                  ),
                }
              : chat,
          ),
        ),
    );
    socket.current.on("chat:kicked", (event: { chatId: string }) => {
      setChats((items) => {
        const remaining = items.filter((chat) => chat.id !== event.chatId);
        setActiveId((id) =>
          id === event.chatId ? (remaining[0]?.id ?? "") : id,
        );
        return remaining;
      });
      setMobileChat(false);
      setToast("Вас исключили из группы");
    });
    const desktop = window.matchMedia("(min-width: 768px)");
    document.addEventListener("visibilitychange", visibility);
    desktop.addEventListener("change", visibility);
    const timer = setInterval(
      () => socket.current?.emit("presence:heartbeat"),
      30000,
    );
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
      desktop.removeEventListener("change", visibility);
      window.removeEventListener(AUTH_EVENT, updateSocketAuth);
      window.removeEventListener("offline",browserOffline);
      window.removeEventListener("online",browserOnline);
      client.io.off("reconnect_attempt", updateSocketAuth);
      client.off("connect_error", reconnectWithRefresh);
      client.off("connect",connected);
      client.off("disconnect",disconnected);
      socket.current?.disconnect();
    };
  }, []);
  useEffect(() => {
    if (!activeId) return;
    setHasOlder(false);
    reloadMessages(activeId)
      .catch(() => {});
    socket.current?.emit("chat:join", { chatId: activeId });
  }, [activeId]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const open = (chatId?: string | null) => {
      if (chatId) {
        setActiveId(chatId);
        setMobileChat(true);
      }
    };
    open(new URLSearchParams(location.search).get("chatId"));
    const listener = (event: MessageEvent) => {
      if (event.data?.type === "OPEN_CHAT") open(event.data.chatId);
    };
    navigator.serviceWorker?.addEventListener("message", listener);
    return () =>
      navigator.serviceWorker?.removeEventListener("message", listener);
  }, []);
  async function select(id: string) {
    if(voice&&voice.chatId!==id){
      if(!confirm("Покинуть текущий голосовой чат и открыть другой чат?"))return;
      await leaveVoice();
    }
    setActiveId(id);
    setMobileChat(true);
    setAttachment(null);
  }
  async function loadOlder(){
    if(loadingOlder||!hasOlder)return;const oldest=messagesRef.current[0];const container=messageList.current;if(!oldest||!container)return;
    setLoadingOlder(true);const previousHeight=container.scrollHeight;
    try{
      const page=await api<Message[]>(`/chats/${activeIdRef.current}/messages?cursor=${encodeURIComponent(oldest.id)}`);
      const older=page.reverse();setMessages((items)=>[...older.filter((message)=>!items.some((item)=>item.id===message.id)),...items]);setHasOlder(page.length===50);
      requestAnimationFrame(()=>{if(messageList.current)messageList.current.scrollTop=messageList.current.scrollHeight-previousHeight});
    }catch(error){setToast((error as Error).message)}finally{setLoadingOlder(false)}
  }
  async function logout(){
    const refreshToken=getRefreshToken();
    try{if(refreshToken)await api("/auth/logout",{method:"POST",body:JSON.stringify({refreshToken})})}
    catch{}finally{socket.current?.disconnect();clearSession()}
  }
  function chooseFile(file?: File) {
    if (!file) return;
    try {
      validateUpload(file, "MESSAGE");
      setAttachment(file);
      setProgress(0);
    } catch (error) {
      setToast((error as Error).message);
    }
  }
  function cancelAttachment() {
    if (uploading) uploadController.current?.abort();
    setAttachment(null);
    setProgress(0);
  }
  async function sendMessage(payload: Record<string, unknown>) {
    if (socket.current?.connected)
      return new Promise<Message>((resolve, reject) => {
        const client=socket.current!;
        const exception=(value:{message?:string}|string)=>{client.off("exception",exception);reject(new Error(typeof value==="string"?value:(value.message??"Не удалось отправить сообщение")))};
        client.once("exception",exception);
        client.timeout(10000).emit(
            "message:send",
            payload,
            (error: Error | null, message: Message) => {client.off("exception",exception);error?reject(new Error("Не удалось отправить сообщение")):resolve(message)},
          );
      });
    return api<Message>(`/chats/${activeId}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if ((!text.trim() && !attachment) || uploading) return;
    if (editing) {
      try{
        const updated=await api<Message>(`/chats/messages/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ body: text }),
        });
        setMessages((items)=>items.map((message)=>message.id===updated.id?updated:message));setEditing(null);setText("");
      }catch(error){setToast((error as Error).message)}
      return;
    }
    setUploading(true);
    uploadController.current = new AbortController();
    try {
      const uploaded = attachment
        ? await uploadFile(
            attachment,
            "MESSAGE",
            activeId,
            setProgress,
            uploadController.current.signal,
          )
        : null;
      const payload = {
        chatId: activeId,
        body: text.trim(),
        replyToId: reply?.id,
        ...(uploaded
          ? {
              mediaUrl: uploaded.fileUrl,
              mediaName: uploaded.fileName,
              mediaType: uploaded.mimeType,
              mediaSize: uploaded.size,
            }
          : {}),
      };
      const message = await sendMessage(payload);
      setMessages((xs) =>
        xs.some((m) => m.id === message.id) ? xs : [...xs, message],
      );
      setText("");
      setReply(null);
      setAttachment(null);
      setProgress(0);
      socket.current?.emit("typing:stop", { chatId: activeId });
    } catch (error) {
      if ((error as Error).name !== "AbortError")
        setToast((error as Error).message);
    } finally {
      setUploading(false);
    }
  }
  function edit(m: Message) {
    setEditing(m);
    setText(m.body);
  }
  async function remove(m: Message) {
    try{const deleted=await api<Message>(`/chats/messages/${m.id}`,{method:"DELETE"});setMessages((items)=>items.map((message)=>message.id===m.id?deleted:message))}
    catch(error){setToast((error as Error).message)}
  }
  function react(m: Message, emoji: string) {
    const existing=m.reactions.some((reaction)=>reaction.userId===me.id&&reaction.emoji===emoji);
    const optimistic=existing?m.reactions.filter((reaction)=>!(reaction.userId===me.id&&reaction.emoji===emoji)):[...m.reactions,{emoji,userId:me.id}];
    setMessages((xs) =>
      xs.map((v) =>
        v.id === m.id
          ? { ...v, reactions: optimistic }
          : v,
      ),
    );
    if (!m.id.startsWith("local"))
      api<{reactions:Reaction[]}>(`/chats/messages/${m.id}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      }).then((result)=>setMessages((items)=>items.map((message)=>message.id===m.id?{...message,reactions:result.reactions}:message)))
        .catch((error)=>{setMessages((items)=>items.map((message)=>message.id===m.id?{...message,reactions:m.reactions}:message));setToast(error.message)});
  }
  async function leaveVoice(){
    const current=voiceRef.current;if(!current||leavingVoice.current)return;
    leavingVoice.current=true;
    try{await api(`/voice/${current.chatId}/leave`,{method:"POST"})}
    catch(error){setToast((error as Error).message)}
    finally{voiceRef.current=null;setVoice(null);leavingVoice.current=false}
  }
  async function joinVoice() {
    if(voice)return;
    try{
      const v = await api<{ token: string; url: string }>(
        `/voice/${activeId}/token`,
        { method: "POST", body: JSON.stringify({ displayName: me.displayName }) },
      );
      setVoice({...v,chatId:activeId});
      setRightOpen(true);
    }catch(error){setToast(`Не удалось подключиться к голосовому чату: ${(error as Error).message}`)}
  }
  function acceptCreated(chat:Chat){
    const normalized={...chat,messages:chat.messages??[],unreadCount:chat.unreadCount??0};
    setChats((items)=>items.some((item)=>item.id===chat.id)?items.map((item)=>item.id===chat.id?normalized:item):[normalized,...items]);
    setActiveId(chat.id);setMobileChat(true);
  }
  if (!active && !chatsLoaded)
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-slate-50 text-slate-500 dark:bg-slate-950">
        Загружаем чаты…
      </div>
    );
  if (!active)
    return (
      <>
       <div className="grid min-h-[100dvh] place-items-center bg-slate-50 p-4 dark:bg-slate-950">
        <section className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-xl dark:bg-slate-900">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-500 text-white">
            <MessageCircle />
          </span>
          <h1 className="mt-4 text-2xl font-bold">Pulse</h1>
          <p className="mt-4 font-semibold">Пока нет чатов</p>
          <p className="mt-1 text-sm text-slate-500">
            Откройте приглашение от друга, чтобы присоединиться к группе.
          </p>
          <button onClick={()=>setNewChatOpen(true)} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-indigo-500 px-5 py-3 font-semibold text-white"><Plus size={18}/>Создать первый чат</button>
        </section>
       </div>
       <NewChatDialog open={newChatOpen} onClose={()=>setNewChatOpen(false)} onCreated={acceptCreated} onError={setToast}/>
       {toast&&<div role="alert" className="fixed bottom-5 left-1/2 z-[80] -translate-x-1/2 rounded-2xl bg-slate-950 px-4 py-3 text-white">{toast}</div>}
      </>
    );
  return (
    <>
      <div className="mx-auto grid h-[100dvh] max-w-[1600px] grid-cols-1 overflow-hidden bg-white shadow-soft dark:bg-slate-900 md:grid-cols-[320px_1fr] xl:grid-cols-[340px_minmax(420px,1fr)_360px]">
        <aside
          className={`${mobileChat ? "hidden md:flex" : "flex"} min-w-0 flex-col border-r border-slate-200 dark:border-slate-800`}
          aria-label="Список чатов"
        >
          <header className="flex h-20 items-center gap-3 px-5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500 text-white">
              <MessageCircle />
            </span>
            <b className="text-xl">Pulse</b>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="ml-auto rounded-xl p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Переключить тему"
            >
              {theme === "dark" ? <Sun /> : <Moon />}
            </button>
          </header>
          <div className="px-4">
            <label className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-3 dark:bg-slate-800">
              <Search size={18} />
              <input
                value={chatSearch}
                onChange={(event)=>setChatSearch(event.target.value)}
                className="w-full bg-transparent outline-none"
                placeholder="Поиск"
                aria-label="Поиск по чатам"
              />
            </label>
            <div className="mt-3 flex gap-1" role="tablist">
              {([["ALL","Все"],["DIRECT","Личные"],["GROUP","Группы"]] as const).map(([value,label]) => (
                <button
                  key={value}
                  onClick={()=>setChatFilter(value)}
                  aria-pressed={chatFilter===value}
                  className={`rounded-xl px-3 py-2 text-sm font-medium ${chatFilter===value ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50" : "text-slate-500"}`}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => setNewChatOpen(true)}
                className="ml-auto rounded-xl bg-indigo-500 p-2 text-white"
                aria-label="Создать группу"
                title="Создать группу"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
          <nav className="scrollbar mt-3 flex-1 overflow-y-auto px-2">
            {visibleChats.map((c) => {
              const n = title(c, me.id);
              return (
                <button
                  key={c.id}
                  onClick={() => select(c.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl p-3 text-left transition ${activeId === c.id ? "bg-indigo-50 dark:bg-indigo-950/40" : "hover:bg-slate-50 dark:hover:bg-slate-800/60"}`}
                >
                  {avatar(n, chatOnline(c,me.id), c.avatarUrl)}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between">
                      <b className="truncate">{n}</b>
                      <small className="text-slate-400">{listTime(c.messages[0]?.createdAt)}</small>
                    </span>
                    <span className="mt-1 flex items-center gap-2">
                      <span className="truncate text-sm text-slate-500">
                        {c.messages[0]?.body ||
                          c.messages[0]?.mediaName ||
                          "Новый чат"}
                      </span>
                      {Boolean(c.unreadCount) && (
                        <i className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-indigo-500 px-1 text-xs not-italic text-white">
                          {c.unreadCount! > 99 ? "99+" : c.unreadCount}
                        </i>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
            {visibleChats.length===0&&<p className="px-4 py-8 text-center text-sm text-slate-500">Чаты не найдены</p>}
          </nav>
          <footer className="flex items-center gap-3 border-t border-slate-200 p-4 dark:border-slate-800">
            <AvatarUploader
              scope="USER_AVATAR"
              onUploaded={(url) =>
                setMe((user) => ({ ...user, avatarUrl: url }))
              }
              onError={setToast}
            >
              {avatar(me.displayName, true, me.avatarUrl)}
            </AvatarUploader>
            <span>
              <b>{me.displayName}</b>
              <small className="block text-emerald-500">
                в сети · нажмите на фото
              </small>
            </span>
            <PushNotifications onError={setToast} />
            <button onClick={()=>void logout()} className="rounded-xl p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/30" aria-label="Выйти"><LogOut size={20}/></button>
          </footer>
        </aside>
        <section
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            chooseFile(e.dataTransfer.files[0]);
          }}
          className={`${mobileChat ? "flex" : "hidden md:flex"} relative min-w-0 flex-col`}
          aria-label={`Чат ${title(active, me.id)}`}
        >
          {dragging && (
            <div className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-3xl border-2 border-dashed border-indigo-400 bg-indigo-50/95 text-center text-indigo-600 shadow-xl dark:bg-indigo-950/95">
              <div>
                <Paperclip className="mx-auto mb-2" />
                <b>Перетащите файл сюда</b>
                <p className="text-sm">Изображение до 10 МБ, файл до 25 МБ</p>
              </div>
            </div>
          )}
          <header className="flex h-20 items-center gap-3 border-b border-slate-200 px-4 dark:border-slate-800">
            <button
              onClick={() => setMobileChat(false)}
              className="rounded-xl p-2 md:hidden"
              aria-label="Назад"
            >
              <ArrowLeft />
            </button>
            {avatar(title(active, me.id), chatOnline(active,me.id), active.avatarUrl)}
            <div className="min-w-0">
              <h1 className="truncate font-bold">{title(active, me.id)}</h1>
              <p className="text-sm text-slate-500">
                {typing ? "печатает…" : active.type==="DIRECT"?(chatOnline(active,me.id)?"в сети":"не в сети"):`${active.members.length} участника`}
              </p>
            </div>
            {active.type === "GROUP" && (
              <button
                onClick={joinVoice}
                className="ml-auto rounded-xl bg-indigo-50 p-2.5 text-indigo-600 dark:bg-indigo-950/40"
                aria-label="Начать голосовой чат"
              >
                <Phone />
              </button>
            )}
            <button
              onClick={() => setRightOpen(voice ? true : !rightOpen)}
              className={`${active.type === "DIRECT" ? "ml-auto" : ""} rounded-xl p-2.5 hover:bg-slate-100 dark:hover:bg-slate-800`}
              aria-label="Информация о чате"
            >
              <Info />
            </button>
          </header>
          <div
            ref={messageList}
            onScroll={(event)=>{if(event.currentTarget.scrollTop<80)void loadOlder()}}
            className="scrollbar flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-4 dark:bg-slate-950/30 sm:p-6"
            aria-label="История сообщений"
            aria-live="polite"
          >
            {loadingOlder&&<div className="mx-auto w-fit rounded-full bg-white px-3 py-1 text-xs text-slate-500 shadow dark:bg-slate-800">Загружаем историю…</div>}
            <div className="mx-auto my-5 w-fit rounded-full bg-slate-200 px-3 py-1 text-xs text-slate-500 dark:bg-slate-800">
              Сегодня
            </div>
            {messages.map((m) => {
              if (m.kind === "SYSTEM")
                return (
                  <div
                    key={m.id}
                    className="mx-auto max-w-[90%] py-2 text-center text-xs text-slate-400"
                  >
                    {m.body}
                  </div>
                );
              const mine = m.authorId === me.id;
              return (
                <article
                  key={m.id}
                  tabIndex={0}
                  onPointerDown={(event)=>{if(event.pointerType==="mouse")return;actionTimer.current=setTimeout(()=>setActiveActions(m.id),500)}}
                  onPointerUp={()=>{if(actionTimer.current)clearTimeout(actionTimer.current)}}
                  onPointerCancel={()=>{if(actionTimer.current)clearTimeout(actionTimer.current)}}
                  onBlur={(event)=>{if(!event.currentTarget.contains(event.relatedTarget))setActiveActions(null)}}
                  className={`message-pop group flex gap-2 ${mine ? "justify-end" : ""}`}
                >
                  {!mine &&
                    avatar(m.author.displayName, false, m.author.avatarUrl)}
                  <div
                    className={`max-w-[82%] sm:max-w-[68%] ${mine ? "items-end" : "items-start"} flex flex-col`}
                  >
                    <div
                      className={`relative rounded-2xl px-4 py-2.5 ${mine ? "rounded-br-md bg-indigo-500 text-white" : "rounded-bl-md bg-white shadow-sm dark:bg-slate-800"}`}
                    >
                      {m.replyTo && (
                        <button
                          className={`mb-2 block w-full border-l-2 pl-2 text-left text-xs ${mine ? "border-indigo-200" : "border-indigo-500 text-slate-500"}`}
                        >
                          <b>{m.replyTo.author.displayName}</b>
                          <span className="block truncate">
                            {m.replyTo.body || m.replyTo.mediaName}
                          </span>
                        </button>
                      )}
                      {m.deletedAt ? (
                        <i className="opacity-70">Сообщение удалено</i>
                      ) : (
                        <>
                          {m.mediaUrl && (
                            <MessageMedia
                              url={m.mediaUrl}
                              name={m.mediaName}
                              type={m.mediaType}
                              size={m.mediaSize}
                              onOpen={(url, name) => setViewer({ url, name })}
                            />
                          )}{" "}
                          {m.body && (
                            <p className="whitespace-pre-wrap break-words">
                              {m.body}
                            </p>
                          )}
                        </>
                      )}
                      <span
                        className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${mine ? "text-indigo-100" : "text-slate-400"}`}
                      >
                        {m.editedAt && "изм. "}
                        {new Date(m.createdAt).toLocaleTimeString("ru", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {mine && <Check size={13} />}
                      </span>
                      <div
                        className={`absolute top-0 z-10 ${activeActions===m.id?"flex":"hidden"} -translate-y-full gap-1 rounded-xl bg-white p-1 shadow-lg group-hover:flex group-focus-within:flex dark:bg-slate-700 ${mine ? "right-0" : "left-0"}`}
                      >
                        <button
                          onClick={() => setReply(m)}
                          className="p-1.5"
                          aria-label="Ответить"
                        >
                          <Reply size={15} />
                        </button>
                        <button
                          onClick={() => react(m, "👍")}
                          className="p-1.5"
                          aria-label="Поставить реакцию"
                        >
                          👍
                        </button>
                        {mine && (
                          <>
                            <button
                              onClick={() => edit(m)}
                              className="p-1.5"
                              aria-label="Изменить"
                            >
                              <Edit3 size={15} />
                            </button>
                            <button
                              onClick={() => remove(m)}
                              className="p-1.5 text-rose-500"
                              aria-label="Удалить"
                            >
                              <Trash2 size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {m.reactions.length > 0 && (
                      <div className="-mt-1 mr-2 rounded-full bg-white px-2 py-0.5 text-xs shadow dark:bg-slate-700">
                        {m.reactions.map((r) => r.emoji).join(" ")}
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
            {typing && (
              <div
                className="flex gap-1 pl-14 text-xl text-slate-400"
                aria-label="Собеседник печатает"
              >
                <i>•</i>
                <i>•</i>
                <i>•</i>
              </div>
            )}
          </div>
          {(reply || editing) && (
            <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-5 py-2 text-sm dark:border-slate-700 dark:bg-slate-800">
              <Reply size={16} className="text-indigo-500" />
              <span className="min-w-0 flex-1 truncate">
                <b>
                  {editing
                    ? "Редактирование"
                    : `Ответ для ${reply?.author.displayName}`}
                </b>{" "}
                · {editing?.body ?? reply?.body}
              </span>
              <button
                onClick={() => {
                  setReply(null);
                  setEditing(null);
                  setText("");
                }}
                aria-label="Отменить"
              >
                <X size={18} />
              </button>
            </div>
          )}
          {attachment && (
            <AttachmentPreview
              file={attachment}
              progress={progress}
              uploading={uploading}
              onRemove={cancelAttachment}
            />
          )}
          {muted ? (
            <div className="border-t border-slate-200 bg-slate-50 p-4 text-center text-sm font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900">
              <VolumeX className="mx-auto mb-1" size={20} />
              Вы не можете писать в этом чате
              {ownMembership?.mutedUntil && (
                <small className="block font-normal">
                  Ограничение до{" "}
                  {new Date(ownMembership.mutedUntil).toLocaleString("ru")}
                </small>
              )}
            </div>
          ) : (
            <form
              onSubmit={submit}
              className="flex items-end gap-2 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 sm:p-4"
            >
              <input
                ref={fileInput}
                type="file"
                className="sr-only"
                onChange={(e) => {
                  chooseFile(e.target.files?.[0]);
                  e.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="rounded-xl p-2.5 text-slate-500 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-800"
                aria-label="Прикрепить файл"
              >
                <Paperclip />
              </button>
              <label className="flex min-h-11 flex-1 items-center rounded-2xl bg-slate-100 px-4 dark:bg-slate-800">
                <input
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    socket.current?.emit("typing:start", { chatId: activeId });
                  }}
                  className="w-full bg-transparent py-3 outline-none"
                  placeholder="Сообщение…"
                  aria-label="Текст сообщения"
                />
                <button type="button" aria-label="Выбрать эмодзи">
                  <Smile className="text-slate-400" />
                </button>
              </label>
              <button
                className="rounded-xl bg-indigo-500 p-3 text-white transition hover:bg-indigo-600 disabled:opacity-40"
                disabled={(!text.trim() && !attachment) || uploading}
                aria-label="Отправить"
              >
                <Send size={20} />
              </button>
            </form>
          )}
        </section>
        <aside
          className={`${rightOpen ? "xl:flex" : "hidden"} hidden min-w-0 flex-col border-l border-slate-200 dark:border-slate-800`}
          aria-label="Информация о чате"
        >
          {voice&&wideLayout ? (
            <VoicePanel
              token={voice.token}
              url={voice.url}
              onLeave={() => void leaveVoice()}
              onError={setToast}
            />
          ) : (
            <>
              <header className="flex h-20 items-center border-b border-slate-200 px-5 dark:border-slate-800">
                <b>Информация</b>
                <button
                  onClick={() => setRightOpen(false)}
                  className="ml-auto rounded-xl p-2"
                  aria-label="Закрыть"
                >
                  <X />
                </button>
              </header>
              <div className="scrollbar flex-1 overflow-y-auto p-5">
                <div className="flex flex-col items-center py-5">
                  {active.type === "GROUP" ? (
                    <AvatarUploader
                      scope="CHAT_AVATAR"
                      chatId={active.id}
                      onUploaded={(url) =>
                        setChats((items) =>
                          items.map((chat) =>
                            chat.id === active.id
                              ? { ...chat, avatarUrl: url }
                              : chat,
                          ),
                        )
                      }
                      onError={setToast}
                    >
                      {avatar(title(active, me.id), true, active.avatarUrl)}
                    </AvatarUploader>
                  ) : (
                    avatar(title(active, me.id), true, active.avatarUrl)
                  )}
                  <h2 className="mt-3 text-xl font-bold">
                    {title(active, me.id)}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {active.type === "GROUP"
                      ? "Открытая команда · нажмите на фото"
                      : "в сети"}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    [ImageIcon, "Медиа"],
                    [File, "Файлы"],
                    [Archive, "Ссылки"],
                  ].map(([Icon, label]: any) => (
                    <button
                      key={label}
                      className="rounded-2xl bg-slate-50 p-3 text-center text-xs dark:bg-slate-800"
                    >
                      <Icon className="mx-auto mb-1" size={20} />
                      {label}
                    </button>
                  ))}
                </div>
                {active.type === "GROUP" ? (
                  <GroupManagement
                    chatId={active.id}
                    members={active.members}
                    meId={me.id}
                    onMember={(updated) =>
                      setChats((items) =>
                        items.map((chat) =>
                          chat.id === active.id
                            ? {
                                ...chat,
                                members: chat.members.map((member) =>
                                  member.user.id === updated.user.id
                                    ? updated
                                    : member,
                                ),
                              }
                            : chat,
                        ),
                      )
                    }
                    onRemove={(userId) =>
                      setChats((items) =>
                        items.map((chat) =>
                          chat.id === active.id
                            ? {
                                ...chat,
                                members: chat.members.filter(
                                  (member) => member.user.id !== userId,
                                ),
                              }
                            : chat,
                        ),
                      )
                    }
                    onError={setToast}
                  />
                ) : (
                  <div className="mt-7 space-y-2">
                    {active.members.map((member) => (
                      <div
                        key={member.user.id}
                        className="flex items-center gap-3 p-2"
                      >
                        {avatar(
                          member.user.displayName,
                          member.user.online,
                          member.user.avatarUrl,
                        )}
                        <b>{member.user.displayName}</b>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {active.type === "GROUP" && (
                <button
                  onClick={joinVoice}
                  className="m-5 flex items-center justify-center gap-2 rounded-2xl bg-indigo-500 p-3 font-semibold text-white"
                >
                  <Mic />
                  Войти в голосовой чат
                </button>
              )}
            </>
          )}
        </aside>
      </div>
      {connectionLost&&<div role="status" className="fixed left-1/2 top-3 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-lg"><WifiOff size={16}/>Нет соединения…</div>}
      {voice&&!wideLayout&&<div className="fixed inset-0 z-[65] bg-slate-950/60 md:grid md:place-items-center md:p-6"><section aria-label="Активный голосовой чат" className="h-full w-full overflow-hidden bg-white shadow-2xl dark:bg-slate-900 md:h-[min(720px,calc(100dvh-3rem))] md:max-w-md md:rounded-3xl"><VoicePanel token={voice.token} url={voice.url} onLeave={()=>void leaveVoice()} onError={setToast}/></section></div>}
      <NewChatDialog open={newChatOpen} onClose={()=>setNewChatOpen(false)} onCreated={acceptCreated} onError={setToast}/>
      <ImageViewer image={viewer} onClose={() => setViewer(null)} />
      {toast && (
        <div
          role="alert"
          className="fixed bottom-5 left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl bg-slate-950 px-4 py-3 text-center text-sm text-white shadow-xl dark:bg-white dark:text-slate-950"
        >
          {toast}
        </div>
      )}
    </>
  );
}
