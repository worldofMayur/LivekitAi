import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Room, RoomEvent, createLocalAudioTrack } from "livekit-client";

type ReqStatus = "PENDING" | "RESOLVED" | "UNRESOLVED";
type HelpRequest = { id:string; callerId:string; question:string; status:ReqStatus; createdAt:string; timeoutAt:string; };
type KBEntry = { id:string; questionCanonical:string; answerText:string; source:string; createdAt:string; };

const API = "http://localhost:8000";

/* ===== Utilities ===== */
function speak(text: string) {
  const u = new SpeechSynthesisUtterance(text);
  window.speechSynthesis.speak(u);
}

function useSTT(onResult: (text: string) => void) {
  const start = () => {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) { alert("SpeechRecognition not supported in this browser."); return; }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e: any) => onResult(e.results[0][0].transcript);
    rec.start();
  };
  return { start };
}

function shallowEqual(a: any, b: any) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function App() {
  /* ===== LiveKit / Voice ===== */
  const [lkConnected, setLkConnected] = useState(false);
  const roomRef = useRef<Room | null>(null);

  /* ===== Data ===== */
  const [allRequests, setAllRequests] = useState<HelpRequest[]>([]);
  const [kb, setKb] = useState<KBEntry[]>([]);
  const pending = useMemo(() => allRequests.filter(r => r.status === "PENDING"), [allRequests]);
  const history = useMemo(() => allRequests.filter(r => r.status !== "PENDING"), [allRequests]);

  /* ===== UI State ===== */
  const [tab, setTab] = useState<"pending"|"history"|"kb">("pending");
  const [selected, setSelected] = useState<HelpRequest | null>(null);
  const [answer, setAnswer] = useState("");

  /* ===== Log (no React state; fast) ===== */
  const logRef = useRef<HTMLPreElement | null>(null);
  const log = useCallback((m: string) => {
    const el = logRef.current;
    if (!el) return;
    el.textContent += m + "\n";
    // keep last ~500 lines to avoid growing forever
    const lines = el.textContent.split("\n");
    if (lines.length > 500) el.textContent = lines.slice(-500).join("\n");
    el.scrollTop = el.scrollHeight;
  }, []);

  /* ===== Polling only when data changes ===== */
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    async function poll() {
      if (!alive) return;
      try {
        const [reqs, k] = await Promise.all([
          axios.get(`${API}/api/requests`, { signal: controller.signal }),
          axios.get(`${API}/api/kb`,       { signal: controller.signal }),
        ]);

        if (!shallowEqual(reqs.data, allRequests)) setAllRequests(reqs.data);
        if (!shallowEqual(k.data, kb)) setKb(k.data);
      } catch (_) {
        /* ignore network blips */
      } finally {
        if (alive) setTimeout(poll, 2500); // smoother than setInterval; adjusts to work time
      }
    }
    poll();
    return () => { alive = false; controller.abort(); };
  }, [allRequests, kb]);

  /* ===== Voice handlers ===== */
  const { start: startSTT } = useSTT(async (question) => {
    log("You: " + question);
    const payload = { callerId: "caller-001", question, timeoutMinutes: 2 };
    const resp = await axios.post(`${API}/api/agent/calls/receive`, payload);
    if (resp.data.answered) {
      log("Agent: " + resp.data.answer);
      speak(resp.data.answer);
    } else {
      const msg = "Let me check with my supervisor and get back to you.";
      log("Agent: " + msg);
      speak(msg);
      log("(Help request ID: " + resp.data.requestId + ")");
    }
  });

  async function connectLiveKit() {
    try {
      const qp = new URLSearchParams({ room: "demo", user: "mayur" }).toString();
      const { data } = await axios.get(`${API}/token?${qp}`);
      const room = new Room();
      roomRef.current = room;

      room
        .on(RoomEvent.Connected,     () => log("*** LiveKit connected ***"))
        .on(RoomEvent.Disconnected,  () => log("*** LiveKit disconnected ***"))
        .on(RoomEvent.TrackSubscribed,() => log("*** Remote track subscribed ***"));

      await room.connect(data.url, data.token);
      const mic = await createLocalAudioTrack();
      await room.localParticipant.publishTrack(mic);

      setLkConnected(true);
      const hello = "Connected to LiveKit. You can speak now.";
      log("Agent: " + hello); speak(hello);
    } catch (e: any) {
      log("LiveKit connect error: " + (e?.message || e));
      alert("LiveKit connection failed. Check LIVEKIT env and /token route.");
    }
  }

  async function startCall() {
    await navigator.mediaDevices.getUserMedia({ audio: true });
    const hello = "Hi! I am your voice receptionist. Please ask your question.";
    log("Agent: " + hello); speak(hello);
  }

  async function submitAnswer() {
    if (!selected) return;

    const text = answer.trim();
    if (!text) return;

    try {
      // Send the supervisor's answer to backend
      await axios.post(`${API}/api/requests/${selected.id}/answer`, {
        answerText: text,
      });

      // Immediately follow up with the caller (UX improvement)
      const followup = `Thanks for waiting. Regarding: ${selected.question}. ${text}`;
      log("Agent: " + followup);
      speak(followup);

      // Clear local UI state
      setAnswer("");
      setSelected(null);

      // Polling loop will refresh requests automatically
    } catch (err: any) {
      log("Error submitting answer: " + (err?.message || err));
      alert("Failed to submit the answer. Please try again.");
    }
  }

  useEffect(() => () => { roomRef.current?.disconnect(); }, []);

  /* ====== UI ====== */
  return (
    <div style={styles.page}>
      <h2 style={styles.h2}>LiveKit Voice + Supervisor Console</h2>

      {/* Top: Voice & Tabs */}
      <div style={styles.topRow}>
        {/* Voice Panel */}
        <div style={styles.card}>
          <h3 style={styles.h3}>Call & Voice</h3>
          <div style={styles.actions}>
            <button style={styles.btn} onClick={connectLiveKit} disabled={lkConnected}>Connect LiveKit</button>
            <button style={styles.btn} onClick={startCall}>Start Call</button>
            <button style={styles.btn} onClick={startSTT}>Speak</button>
          </div>
          <small style={styles.tip}>Tip: Connect once → Start Call → Speak.</small>
          <pre ref={logRef} style={styles.log} />
        </div>

        {/* Tabs */}
        <div style={styles.tabs}>
          <button style={{...styles.tabBtn, ...(tab==="pending"?styles.tabActive:{} )}} onClick={()=>setTab("pending")}>Pending</button>
          <button style={{...styles.tabBtn, ...(tab==="history"?styles.tabActive:{} )}} onClick={()=>setTab("history")}>History</button>
          <button style={{...styles.tabBtn, ...(tab==="kb"?styles.tabActive:{} )}} onClick={()=>setTab("kb")}>Learned Answers</button>
        </div>
      </div>

      {/* Bottom: Content */}
      <div style={{...styles.card, contentVisibility:"auto" as any}}>
        {tab === "pending" && (
          <>
            <h3 style={styles.h3}>Pending Requests</h3>
            <TablePending rows={pending} onOpen={setSelected} />
            {selected && (
              <div style={styles.drawer}>
                <b>Request {selected.id.slice(0,8)}</b>
                <div><b>Caller:</b> {selected.callerId}</div>
                <div><b>Question:</b> {selected.question}</div>
                <textarea style={styles.textarea} value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="Type supervisor answer..." />
                <div style={styles.row}>
                  <button style={styles.btn} onClick={submitAnswer} disabled={!answer.trim()}>Submit</button>
                  <button style={styles.btnGhost} onClick={()=>setSelected(null)}>Close</button>
                </div>
              </div>
            )}
          </>
        )}

        {tab === "history" && (
          <>
            <h3 style={styles.h3}>History</h3>
            <TableHistory rows={history} />
          </>
        )}

        {tab === "kb" && (
          <>
            <h3 style={styles.h3}>Learned Answers</h3>
            <TableKB rows={kb} />
          </>
        )}
      </div>
    </div>
  );
}

/* ===== Small table components (avoid re-renders) ===== */
function TablePending({ rows, onOpen }: { rows: HelpRequest[]; onOpen: (r:HelpRequest)=>void }) {
  return (
    <table style={styles.table}>
      <thead><tr><th>ID</th><th>Caller</th><th>Question</th><th>Timeout</th><th></th></tr></thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={5}>No pending requests.</td></tr>
        ) : rows.map(r=>(
          <tr key={r.id}><td>{r.id.slice(0,8)}</td><td>{r.callerId}</td><td>{r.question}</td><td>{new Date(r.timeoutAt).toLocaleString()}</td><td><button style={styles.btnXS} onClick={()=>onOpen(r)}>Open</button></td></tr>
        ))}
      </tbody>
    </table>
  );
}

function TableHistory({ rows }: { rows: HelpRequest[] }) {
  return (
    <table style={styles.table}>
      <thead><tr><th>ID</th><th>Status</th><th>Caller</th><th>Question</th><th>Created</th></tr></thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={5}>No history yet.</td></tr>
        ) : rows.map(r=>(
          <tr key={r.id}><td>{r.id.slice(0,8)}</td><td>{r.status}</td><td>{r.callerId}</td><td>{r.question}</td><td>{new Date(r.createdAt).toLocaleString()}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function TableKB({ rows }: { rows: KBEntry[] }) {
  return (
    <table style={styles.table}>
      <thead><tr><th>Question (canonical)</th><th>Answer</th><th>Source</th><th>Created</th></tr></thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={4}>No learned answers yet.</td></tr>
        ) : rows.map(k=>(
          <tr key={k.id}><td>{k.questionCanonical}</td><td>{k.answerText}</td><td>{k.source}</td><td>{new Date(k.createdAt).toLocaleString()}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

/* ===== Inline styles (fast, minimal paints) ===== */
const styles: Record<string, any> = {
  page: { padding:16, fontFamily:"system-ui", color:"#e7e9ee", background:"#0f1115", minHeight:"100vh" },
  h2: { margin:0, fontSize:24 },
  h3: { margin:"0 0 8px 0", fontSize:18 },
  topRow: { display:"grid", gridTemplateColumns:"1fr 220px", gap:12, alignItems:"start", margin:"16px 0" },
  card: { background:"#151922", border:"1px solid #232737", borderRadius:10, padding:12 },
  actions: { display:"flex", gap:8, marginBottom:8, flexWrap:"wrap" },
  tabs: { position:"sticky", top:12, display:"flex", flexDirection:"column", gap:8 },
  tabBtn: { padding:"10px 12px", background:"#1a1f2b", border:"1px solid #232737", color:"#e7e9ee", borderRadius:8, textAlign:"left", cursor:"pointer" },
  tabActive: { outline:"2px solid #4b5cc4", background:"#232737" },
  tip: { opacity:0.75 },
  log: { whiteSpace:"pre-wrap", marginTop:8, background:"#0f1115", padding:8, borderRadius:6, maxHeight:160, overflow:"auto" },
  table: { width:"100%", borderCollapse:"collapse" as const, background:"#0f1219" , border:"1px solid #232737" },
  drawer: { marginTop:16, padding:12, border:"1px solid #232737", borderRadius:8, background:"#0f1219" },
  textarea: { width:"100%", height:100, marginTop:8, background:"#0f1115", color:"#e7e9ee", border:"1px solid #232737", borderRadius:8, padding:8, resize:"vertical" as const },
  row: { display:"flex", gap:8, marginTop:8 },
  btn: { background:"#2b3a90", color:"#fff", border:"none", borderRadius:8, padding:"10px 12px", cursor:"pointer" },
  btnGhost: { background:"transparent", color:"#e7e9ee", border:"1px solid #3a3f56", borderRadius:8, padding:"10px 12px", cursor:"pointer" },
  btnXS: { background:"#2b3a90", color:"#fff", border:"none", borderRadius:6, padding:"6px 8px", cursor:"pointer" },
};
