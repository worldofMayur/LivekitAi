import { useEffect, useState } from "react";
import axios from "axios";

type ReqStatus = "PENDING" | "RESOLVED" | "UNRESOLVED";
type HelpRequest = {
  id: string;
  callerId: string;
  question: string;
  status: ReqStatus;
  createdAt: string;
  timeoutAt: string;
};
type KBEntry = {
  id: string;
  questionCanonical: string;
  answerText: string;
  source: string;
  createdAt: string;
};

const API = "http://localhost:8000";

export default function App() {
  const [tab, setTab] = useState<"pending" | "history" | "kb">("pending");
  const [pending, setPending] = useState<HelpRequest[]>([]);
  const [history, setHistory] = useState<HelpRequest[]>([]);
  const [kb, setKb] = useState<KBEntry[]>([]);
  const [selected, setSelected] = useState<HelpRequest | null>(null);
  const [answer, setAnswer] = useState("");

  async function load() {
    const p = await axios.get(`${API}/api/requests`, { params: { status: "PENDING" } });
    const all = await axios.get(`${API}/api/requests`);
    const k = await axios.get(`${API}/api/kb`);
    setPending(p.data);
    setHistory(all.data.filter((r: HelpRequest) => r.status !== "PENDING"));
    setKb(k.data);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 3000); // auto-refresh every 3s to see new requests
    return () => clearInterval(t);
  }, []);

  async function submitAnswer() {
    if (!selected) return;
    await axios.post(`${API}/api/requests/${selected.id}/answer`, { answerText: answer });
    setAnswer("");
    setSelected(null);
    load();
  }

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", color: "#e7e9ee", background: "#0f1115", minHeight: "100vh" }}>
      <h2 style={{ marginTop: 0 }}>Supervisor Console</h2>
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <button onClick={() => setTab("pending")}>Pending</button>
        <button onClick={() => setTab("history")}>History</button>
        <button onClick={() => setTab("kb")}>Learned Answers</button>
      </div>

      {tab === "pending" && (
        <>
          <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse", background: "#151922" }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Caller</th>
                <th>Question</th>
                <th>Timeout</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid #232737" }}>
                  <td>{r.id.slice(0, 8)}</td>
                  <td>{r.callerId}</td>
                  <td>{r.question}</td>
                  <td>{new Date(r.timeoutAt).toLocaleString()}</td>
                  <td>
                    <button onClick={() => setSelected(r)}>Open</button>
                  </td>
                </tr>
              ))}
              {pending.length === 0 && (
                <tr>
                  <td colSpan={5}>No pending requests.</td>
                </tr>
              )}
            </tbody>
          </table>

          {selected && (
            <div style={{ marginTop: 16, padding: 12, border: "1px solid #232737", borderRadius: 8, background: "#151922" }}>
              <b>Request {selected.id.slice(0, 8)}</b>
              <div>
                <b>Caller:</b> {selected.callerId}
              </div>
              <div>
                <b>Question:</b> {selected.question}
              </div>
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type supervisor answer..."
                style={{ width: "100%", height: 100, marginTop: 8 }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={submitAnswer} disabled={!answer.trim()}>
                  Submit
                </button>
                <button onClick={() => setSelected(null)}>Close</button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === "history" && (
        <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse", background: "#151922" }}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Status</th>
              <th>Caller</th>
              <th>Question</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {history.map((r) => (
              <tr key={r.id} style={{ borderTop: "1px solid #232737" }}>
                <td>{r.id.slice(0, 8)}</td>
                <td>{r.status}</td>
                <td>{r.callerId}</td>
                <td>{r.question}</td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={5}>No history yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {tab === "kb" && (
        <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse", background: "#151922" }}>
          <thead>
            <tr>
              <th>Question (canonical)</th>
              <th>Answer</th>
              <th>Source</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {kb.map((k) => (
              <tr key={k.id} style={{ borderTop: "1px solid #232737" }}>
                <td>{k.questionCanonical}</td>
                <td>{k.answerText}</td>
                <td>{k.source}</td>
                <td>{new Date(k.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {kb.length === 0 && (
              <tr>
                <td colSpan={4}>No learned answers yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
