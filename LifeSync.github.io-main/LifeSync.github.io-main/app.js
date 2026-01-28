// Get DOM elements
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');

// Format timestamp
function formatTimestamp() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// Set welcome message timestamp
document.getElementById('welcomeTimestamp').textContent = formatTimestamp();

// Create message element
function createMessage(text, isOwn = true) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isOwn ? 'own-message' : 'other-message'}`;

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';

    const textP = document.createElement('p');
    textP.textContent = text;

    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'message-timestamp';
    timestampSpan.textContent = formatTimestamp();

    bubbleDiv.appendChild(textP);
    messageDiv.appendChild(bubbleDiv);
    messageDiv.appendChild(timestampSpan);

    return messageDiv;
}

// Send message function
function sendMessage() {
    const text = messageInput.value.trim();

    if (text === '') {
        return;
    }

    // Add user's message
    const userMessage = createMessage(text, true);
    messagesContainer.appendChild(userMessage);

    // Clear input
    messageInput.value = '';

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Simulate auto-response after a delay
    if (text !== 'Welcome to LifeSync Texting UI!') {
        setTimeout(() => {
            const responseMessage = createMessage(`Message received: ${text}`, false);
            messagesContainer.appendChild(responseMessage);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }, 500);
    }

    // Focus back on input
    messageInput.focus();
}

// Event listeners
sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Focus input on load
messageInput.focus();
