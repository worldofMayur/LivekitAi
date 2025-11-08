from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime, timedelta, timezone
from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import create_engine, Column, String, Text, DateTime, Enum, ForeignKey, Index
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
import enum, uuid, re
import os, time, jwt
from dotenv import load_dotenv   # add this

load_dotenv()  # add this line right after imports


# ==== LiveKit env ====
LIVEKIT_URL = os.getenv("wss://voice-agent-t5bld539.livekit.cloud", "")
LK_API_KEY = os.getenv("APIsyjHrdvo6mjs", "")
LK_API_SECRET = os.getenv("AtsNVhqSb6X7OVFtyX9a9yHE1Xr2uPjfoGextiWLfXGB", "")

# ==== DB setup
engine = create_engine("sqlite:///./frontdesk.db", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()

# ==== Enums
class ReqStatus(str, enum.Enum):
    PENDING = "PENDING"
    RESOLVED = "RESOLVED"
    UNRESOLVED = "UNRESOLVED"

# ==== Models
class Request(Base):
    __tablename__ = "requests"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    caller_id = Column(String, nullable=False)
    question = Column(Text, nullable=False)
    status = Column(Enum(ReqStatus), default=ReqStatus.PENDING, nullable=False, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    timeout_at = Column(DateTime, nullable=False, index=True)

    # Points to the "chosen" answer row (optional 1:1)
    answer_id = Column(String, ForeignKey("answers.id"), nullable=True, index=True)

    # ✅ Disambiguate: this relationship uses Request.answer_id -> Answer.id
    answer = relationship(
        "Answer",
        foreign_keys=[answer_id],
        primaryjoin="Request.answer_id == Answer.id",
        uselist=False,
    )

class Answer(Base):
    __tablename__ = "answers"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    request_id = Column(String, ForeignKey("requests.id"), index=True)
    answer_text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    # ✅ Disambiguate: this relationship uses Answer.request_id -> Request.id
    request = relationship(
        "Request",
        foreign_keys=[request_id],
        primaryjoin="Answer.request_id == Request.id",
    )

class KBEntry(Base):
    __tablename__ = "kb"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    question_canonical = Column(Text, nullable=False, unique=True)
    answer_text = Column(Text, nullable=False)
    source = Column(String, default="LEARNED")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

# Optional helpful indexes (SQLite ignores many advanced options, but harmless)
Index("ix_requests_status_created", Request.status, Request.created_at)
Index("ix_kb_created", KBEntry.created_at)

Base.metadata.create_all(engine)

# ==== App
app = Flask(__name__)
CORS(app)

def canonicalize(q: str) -> str:
    return " ".join(re.sub(r"[^\w]", " ", q.lower()).split())

def kb_lookup(db, question: str):
    cq = canonicalize(question)
    row = db.query(KBEntry).filter(KBEntry.question_canonical == cq).first()
    return row.answer_text if row else None

def upsert_kb(db, question: str, answer_text: str):
    cq = canonicalize(question)
    row = db.query(KBEntry).filter(KBEntry.question_canonical == cq).first()
    if row:
        row.answer_text = answer_text
    else:
        row = KBEntry(question_canonical=cq, answer_text=answer_text, source="LEARNED")
        db.add(row)
    db.commit()
    return row

@app.post("/api/agent/calls/receive")
def receive_call():
    body = request.get_json(force=True)
    caller_id = body.get("callerId", "caller-001")
    question = body["question"]
    timeout_minutes = int(body.get("timeoutMinutes", 15))

    db = SessionLocal()
    try:
        hit = kb_lookup(db, question)
        if hit:
            print(f"*** Agent immediate voice reply: {hit} ***")
            return jsonify({"answered": True, "answer": hit})

        r = Request(
            caller_id=caller_id,
            question=question,
            timeout_at=datetime.now(timezone.utc) + timedelta(minutes=timeout_minutes),
        )
        db.add(r); db.commit(); db.refresh(r)
        print(f"*** Supervisor ping: Need help answering '{r.question}' (req:{r.id}) ***")
        return jsonify({"answered": False, "requestId": r.id})
    finally:
        db.close()

@app.post("/api/requests/<req_id>/answer")
def answer_request(req_id):
    body = request.get_json(force=True)
    answer_text = body["answerText"]
    db = SessionLocal()
    try:
        # SQLAlchemy 2.0 style get
        r = db.get(Request, req_id)
        if not r:
            return jsonify({"error":"not found"}), 404
        if r.status != ReqStatus.PENDING:
            return jsonify({"error":"not pending"}), 400

        a = Answer(request_id=r.id, answer_text=answer_text)
        db.add(a); db.flush()  # a.id now available

        r.answer_id = a.id
        r.status = ReqStatus.RESOLVED
        r.updated_at = datetime.now(timezone.utc)
        db.commit()

        print(f"*** Follow-up to {r.caller_id}: Regarding '{r.question}': {answer_text} ***")
        upsert_kb(db, r.question, answer_text)
        return jsonify({"ok": True})
    finally:
        db.close()

@app.get("/api/requests")
def list_requests():
    status = request.args.get("status")
    db = SessionLocal()
    try:
        q = db.query(Request)
        if status:
            try:
                q = q.filter(Request.status == ReqStatus(status))
            except ValueError:
                return jsonify({"error":"invalid status"}), 400
        rows = q.order_by(Request.created_at.desc()).all()
        data = [{
            "id": r.id,
            "callerId": r.caller_id,
            "question": r.question,
            "status": r.status.value,
            "createdAt": r.created_at.isoformat(),
            "timeoutAt": r.timeout_at.isoformat(),
        } for r in rows]
        return jsonify(data)
    finally:
        db.close()

@app.get("/api/kb")
def list_kb():
    db = SessionLocal()
    try:
        rows = db.query(KBEntry).order_by(KBEntry.created_at.desc()).all()
        data = [{
            "id": k.id,
            "questionCanonical": k.question_canonical,
            "answerText": k.answer_text,
            "source": k.source,
            "createdAt": k.created_at.isoformat(),
        } for k in rows]
        return jsonify(data)
    finally:
        db.close()

@app.get("/token")
def mint_token():
    from flask import current_app
    try:
        room = request.args.get("room", "demo-room")
        user = request.args.get("user", "guest-" + str(int(time.time())))
        now = int(time.time())
        exp = now + 60 * 10  # 10 minutes

        # Trim accidental spaces/newlines from .env on Windows
        url = (os.getenv("LIVEKIT_URL") or "").strip()
        key = (os.getenv("LIVEKIT_API_KEY") or "").strip()
        secret = (os.getenv("LIVEKIT_API_SECRET") or "").strip()

        # Basic validation with helpful messages
        problems = []
        if not url: problems.append("LIVEKIT_URL is empty")
        if not key: problems.append("LIVEKIT_API_KEY is empty")
        if not secret: problems.append("LIVEKIT_API_SECRET is empty")
        if url and not url.startswith("wss://"):
            problems.append("LIVEKIT_URL must start with wss://")
        if problems:
            return jsonify({"error": "LIVEKIT env not set", "details": problems}), 500

        payload = {
            "iss": key,
            "sub": user,
            "exp": exp,
            "nbf": now - 10,
            "video": {
                "room": room,
                "roomJoin": True,
                "canPublish": True,
                "canSubscribe": True
            }
        }

        token = jwt.encode(payload, secret, algorithm="HS256")
        return jsonify({"token": token, "url": url})
    except Exception as e:
        current_app.logger.exception("Token mint failed")
        # Return the error so you can see it in the browser/Network tab
        return jsonify({"error": "token_mint_failed", "message": str(e)}), 500


def sweep_timeouts():
    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        overdue = db.query(Request).filter(
            Request.status == ReqStatus.PENDING,
            Request.timeout_at <= now
        ).all()
        for r in overdue:
            r.status = ReqStatus.UNRESOLVED
            r.updated_at = now
        if overdue:
            db.commit()
            print(f"*** Timeout sweep marked {len(overdue)} as UNRESOLVED ***")
    finally:
        db.close()

scheduler = BackgroundScheduler(daemon=True)
scheduler.add_job(sweep_timeouts, "interval", seconds=30)
scheduler.start()

if __name__ == "__main__":
    app.run(port=8000, debug=True)
