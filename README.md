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

Start a local web server:

```bash
# Navigate to the src directory
cd src

# Python 3
python3 -m http.server 8080

# Or use any other local server
```

Then open your browser to `http://localhost:8080/main.html`

## App Flow

1. **main.html** - Landing page with features and call-to-action buttons
2. **login.html** - Login page (any username/password works for demo)
3. **index.html** - Chat interface (requires login)

## Project Structure

```
LifeSync/
├── src/
│   ├── main.html       # Landing page
│   ├── login.html      # Login page
│   ├── index.html      # Chat interface
│   ├── styles.css      # All styling
│   └── app.js          # Chat functionality
└── README.md
```

## Usage

1. Open `main.html` in your browser
2. Click "Get Started" or "Login"
3. Enter any username and password
4. Start chatting in the texting interface!
5. Messages appear with timestamps
6. The app auto-responds for testing

## Customization

### Colors

Edit `styles.css` to customize:

- **Gradient backgrounds**: `.home-container` and `.login-container`
- **Primary color**: `.btn-primary` and related elements
- **Chat colors**: `.message-bubble`, `.send-button`

### Authentication

Currently uses simple client-side session storage. To add real authentication:

1. Update the login form submission in `login.html`
2. Add server-side validation
3. Use proper session tokens or JWT

### Auto-response

Edit the `sendMessage()` function in `app.js` to customize or disable auto-responses.

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
