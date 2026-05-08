# PinkVault

A real-time encrypted chat application.

## Architecture

* **Backend**: FastAPI on Render. Handles HTTP endpoints and WebSocket server.
* **Database**: Supabase PostgreSQL. Stores encrypted messages.
* **Frontend**: Vanilla JavaScript SPA on Netlify. No build tools.
* **Security**: Client-side AES encryption via CryptoJS.

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
ALLOWED_USERS=abdi,alysha

```


5. **Run backend**:
```bash
uvicorn main:app --reload

```


6. **Access UI**:
Open `http://localhost:8000/`.

## Deployment Strategy

### Backend (Render)

1. Push to GitHub.
2. Create Render Web Service. Connect repository.
3. **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add `SUPABASE_URL`, `SUPABASE_KEY`, and `ALLOWED_USERS` to Render environment variables.
5. Deploy. Note the Render URL (`https://pinkvault-api.onrender.com`).

### Frontend (Netlify)

1. Deploy `static/` folder to Netlify.
2. Update `static/app.js` to point to the Render backend for both HTTP and WS connections.
3. Update `main.py` CORS settings to lock down the origin to your Netlify URL:
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://pinkvault-app.netlify.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)

```



## API Endpoints

* `GET /health`: Returns 200 OK.
* `GET /history`: Returns full chat history as JSON `[{"sender": "...", "encrypted_text": "..."}]`.
* `GET /`: Serves static frontend.
* `WebSocket /ws`: Real-time messaging.
* Handshake requires plaintext username first.
* Validated against `ALLOWED_USERS`. Invalid connections drop with code 4403.
* Payload: `{"sender": "user", "text": "<AES-encrypted payload>"}`.



## Project Structure

```text
PinkVault/
├── main.py              # FastAPI app & WebSocket logic
├── db.py                # Supabase client
├── requirements.txt     # Python deps
├── static/
│   ├── index.html       # SPA shell
│   ├── style.css        # Mobile-first UI
│   ├── app.js           # Client logic & encryption
│   ├── sw.js            # PWA Service Worker
│   ├── manifest.json    # PWA metadata
│   └── logo.png         # App icon

```

## 📄 License

This project is open-source and available for educational and commercial use under the MIT License.

---

**Made with ❤️ by [Abdul Hayy Khan](https://www.linkedin.com/in/abdulhayykhan/)**