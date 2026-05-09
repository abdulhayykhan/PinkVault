# PinkVault

A real-time encrypted chat application.

## Architecture

* **Backend & Frontend Host**: FastAPI on Render. Handles HTTP endpoints, WebSocket server, and serves the static frontend.
* **Database**: Supabase PostgreSQL. Stores encrypted messages and reactions.
* **Frontend**: Vanilla JavaScript SPA. No build tools.
* **Security**: Client-side AES encryption via CryptoJS.

## Features

* **Real-time Messaging**: Instant encrypted communication via WebSockets.
* **Emoji Reactions**: Support for real-time reactions including a double-tap to heart feature and an Instagram-style long-press/right-click emoji picker.
* **PWA Support**: Installable as a native-like application on mobile and desktop.
* **URL Recognition**: Automatic detection and formatting of clickable links in messages.

## Security

Symmetric key is entered via UI and stored strictly in temporary `sessionStorage`. It is never transmitted to the server.

## Local Setup

**Prerequisites**: Python 3.10+, Supabase account with PostgreSQL.

1. **Clone repository**:
```bash
git clone <repository-url>
cd PinkVault

```


2. **Setup virtual environment**:
```bash
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

```


3. **Install dependencies**:
```bash
pip install -r requirements.txt

```


4. **Configure environment variables**:
Create `.env` in the root:
```env
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_KEY=your-anon-key-here
ALLOWED_USERS=user1,user2

```


5. **Run application**:
```bash
uvicorn main:app --reload

```


6. **Access UI**:
Open `http://localhost:8000/`.

## Deployment Strategy (Render)

1. Push code to GitHub.
2. Create a Render Web Service and connect the repository.
3. **Build Command**: `pip install -r requirements.txt`
4. **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add `SUPABASE_URL`, `SUPABASE_KEY`, and `ALLOWED_USERS` to Render environment variables.
6. Deploy.
7. **Keep-Alive**: Configure a free cron job (e.g., cron-job.org) to ping `https://<your-render-url>/health` every 14 minutes to prevent the free instance from sleeping.

## API Endpoints

* `GET /health`: Returns 200 OK.
* `GET /history`: Returns full chat history as JSON.
* `GET /`: Serves static frontend.
* `WebSocket /ws`: Real-time messaging and reaction handling.
* Handshake requires plaintext username first.
* Validated against `ALLOWED_USERS`.
* Payload Types: `message`, `like`, `ping`.



## Project Structure

```text
PinkVault/
├── main.py              # FastAPI app, WebSocket logic & reaction handling
├── db.py                # Supabase client factory
├── requirements.txt     # Python dependencies
├── schema.sql           # Database table and index definitions
├── static/
│   ├── index.html       # SPA shell & emoji picker markup
│   ├── style.css        # Mobile-first UI & reaction animations
│   ├── app.js           # Encryption, WebSocket client & UI logic
│   ├── sw.js            # PWA Service Worker (Network-first for JS/CSS)
│   ├── manifest.json    # PWA metadata
│   └── logo.png         # App icon

```

## 📄 License

This project is open-source and available for educational and commercial use under the MIT License.

---

**Made with ❤️ by [Abdul Hayy Khan**](https://www.linkedin.com/in/abdulhayykhan/)