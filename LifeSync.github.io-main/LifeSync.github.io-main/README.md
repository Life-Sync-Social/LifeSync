# LifeSync - Web Texting UI

A modern, responsive texting interface built with HTML, CSS, and vanilla JavaScript.

## Features

- Beautiful landing page with feature highlights
- Login authentication system
- Modern chat interface with message bubbles
- Smooth animations and transitions
- Real-time message timestamps
- Clean design with gradient backgrounds
- Fully responsive (mobile and desktop)
- Auto-scrolling to new messages
- Auto-response for testing
- Session management

## Getting Started

### Running the App

**Important:** Start the server from the project root (the folder that contains `index.html`, `first_page/`, `login_signup/`, etc.). Otherwise `../` links will break.

```bash
# Navigate to the project root (where index.html lives)
cd LifeSync.github.io-main/LifeSync.github.io-main

# Python 3
python3 -m http.server 8080

# Or port 8000
python3 -m http.server 8000
```

Then open your browser to:

- **`http://localhost:8080/`** (or `http://localhost:8000/` if you used port 8000)

The app redirects to the landing page. Do **not** use `main.html` — it does not exist.

### Chatbot backend (optional)

For the AI chatbot in the Texting UI:

```bash
cd server
npm install
npm start
```

Backend runs on `http://localhost:3001`. Keep it running while using the Texting page.

## App Flow

1. **index.html** → redirects to **first_page/first_page.html** (landing)
2. **login.html** / **signup.html** — Auth (any username/password for demo)
3. **home_page/index.html** — Dashboard after login
4. **texting_ui/texting.html** — Chat interface (linked from dashboard)

## Project Structure

```
LifeSync.github.io-main/
├── index.html          # Entry point, redirects to first_page
├── base.css            # Shared styles
├── first_page/         # Landing
├── login_signup/       # Login, signup
├── home_page/          # Dashboard
├── texting_ui/         # Chat UI
├── server/             # Chat API (Node)
└── README.md
```

## Usage

1. Open **`http://localhost:8080/`** (or your chosen port) in the browser.
2. Click "Get Started" or "Login".
3. Enter any username and password.
4. From the dashboard, click **Texting** in the sidebar.
5. Start chatting; the AI replies if the backend is running.

## Customization

### Colors

Edit `base.css` and page-specific CSS (e.g. `dashboard.css`, `texting.css`) to customize:

- **Gradient backgrounds**: `.home-container`, `.login-container`
- **Primary color**: `.btn-primary` and related elements
- **Chat colors**: `.message-bubble`, `.send-button`

### Authentication

Currently uses simple client-side session storage. To add real authentication:

1. Update the login form submission in `login_signup/login.html`
2. Add server-side validation
3. Use proper session tokens or JWT

### Chat / auto-response

Edit `texting_ui/app.js` (e.g. `sendMessage`) for chat behavior. The AI backend is in `server/index.js`.

## Browser Compatibility

Works on all modern browsers:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers (iOS Safari, Chrome Mobile)

## Future Enhancements

- Backend API integration
- Real user authentication
- Database for message persistence
- WebSocket for real-time messaging
- User profiles and avatars
- Image and media support
- Group chat support
- Typing indicators
- Read receipts

## License

Free to use and modify!
