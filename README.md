# LivekitAi

🗣️ LiveKit Voice Receptionist + Supervisor Console

A full-stack voice assistant built for the Frontdesk engineering assessment.
It demonstrates a LiveKit-powered receptionist that can talk with users, escalate unknown queries to a supervisor dashboard, and learn from resolutions for future interactions.

🚀 Features
🎧 Voice Interaction (Receptionist)
LiveKit integration — connects to a real-time audio room (wss://…livekit.cloud).
Speech Recognition (STT) — listens to user speech using the browser’s SpeechRecognition API.
Text-to-Speech (TTS) — responds in a soft female voice using the SpeechSynthesis API.
Hands-free mode — optional auto-listen toggle for continuous voice chat.

🧠 Intelligent Learning
Unknown questions are escalated to a supervisor as “Pending”.
Supervisor submits answers → request becomes Resolved.
The system learns the answer (KB entry) for future queries.
Next time, the receptionist answers instantly from the knowledge base.

🧑‍💼 Supervisor Console
View and manage Pending, Resolved, and Unresolved requests.
Submit new answers directly from the dashboard.
Access a list of Learned Answers (KB).

⚙️ Backend Features
Built with Flask + SQLAlchemy + SQLite
Automatic timeout sweeper marks overdue requests UNRESOLVED.
JWT token minting for LiveKit connections.
CORS-enabled REST API.

🗂️ Tech Stack
Layer	    Technology
Frontend	React (Vite), TypeScript, Axios, LiveKit-Client
Backend	    Python, Flask, SQLAlchemy, APScheduler
Database	SQLite
Voice	    Web Speech API (STT/TTS), LiveKit Cloud
Styling	    Minimal dark UI with system fonts

⚙️ Setup Instructions
1️⃣ Backend Setup

cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install flask flask-cors sqlalchemy apscheduler pyjwt python-dotenv
python app.py

Create a .env file inside backend/ with your LiveKit credentials:
LIVEKIT_URL=wss://your-subdomain.livekit.cloud
LIVEKIT_API_KEY=lk_XXXXXXXXXXXXXXXX
LIVEKIT_API_SECRET=YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY

2️⃣ Frontend Setup

cd supervisor-ui
npm install
npm run dev

🧪 Demo Flow
Click Connect LiveKit → log shows “*** LiveKit connected ***”.
Click Start Call → agent greets you with a soft female voice.
Click Speak and ask a question (e.g., “What is your office timing?”)
If unknown → supervisor dashboard shows a Pending request.
Supervisor types and submits an answer.
Agent immediately speaks back the resolution.
Ask the same question again → instant learned answer.
Unanswered requests after 2 minutes become UNRESOLVED automatically.
Switch between Pending, History, and Learned Answers tabs.