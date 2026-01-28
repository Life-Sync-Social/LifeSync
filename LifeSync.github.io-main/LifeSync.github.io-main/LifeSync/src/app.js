// ============================================
// CONFIGURATION - Hugging Face API Settings
// ============================================
// Get your free API key from: https://huggingface.co/settings/tokens
const HUGGING_FACE_API_KEY = 'YOUR_API_KEY_HERE'; // Replace with your API key
const HUGGING_FACE_MODEL = 'microsoft/DialoGPT-medium'; // You can change this to other models

// Alternative models you can try:
// - 'microsoft/DialoGPT-large' (better quality, slower)
// - 'microsoft/DialoGPT-small' (faster, lower quality)
// - 'facebook/blenderbot-400M-distill' (conversational)
// - 'google/flan-t5-base' (instruction following)

// ============================================
// DOM Elements
// ============================================
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');

// ============================================
// Conversation History
// ============================================
let conversationHistory = [];

// ============================================
// Utility Functions
// ============================================

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

// Create loading indicator
function createLoadingIndicator() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message other-message';
    messageDiv.id = 'loading-indicator';

    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';
    bubbleDiv.style.minWidth = '60px';

    const loadingText = document.createElement('p');
    loadingText.textContent = '...';
    loadingText.style.margin = '0';
    loadingText.style.animation = 'pulse 1.5s ease-in-out infinite';

    bubbleDiv.appendChild(loadingText);
    messageDiv.appendChild(bubbleDiv);

    return messageDiv;
}

// Remove loading indicator
function removeLoadingIndicator() {
    const loadingIndicator = document.getElementById('loading-indicator');
    if (loadingIndicator) {
        loadingIndicator.remove();
    }
}

// ============================================
// Hugging Face API Integration
// ============================================

async function getChatbotResponse(userMessage) {
    // Check if API key is set
    if (HUGGING_FACE_API_KEY === 'YOUR_API_KEY_HERE') {
        throw new Error('Please set your Hugging Face API key in app.js');
    }

    try {
        // Build conversation context (last 5 messages for context)
        const recentHistory = conversationHistory.slice(-5);
        const context = recentHistory.map(msg => msg.text).join('\n');
        
        // Prepare the prompt
        const prompt = context ? `${context}\nUser: ${userMessage}\nAssistant:` : `User: ${userMessage}\nAssistant:`;

        // Call Hugging Face Inference API
        const response = await fetch(
            `https://api-inference.huggingface.co/models/${HUGGING_FACE_MODEL}`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${HUGGING_FACE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    inputs: prompt,
                    parameters: {
                        max_new_tokens: 150,
                        temperature: 0.7,
                        top_p: 0.9,
                        return_full_text: false
                    }
                })
            }
        );

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        // Extract the generated text
        let botResponse = '';
        if (Array.isArray(data) && data.length > 0) {
            botResponse = data[0].generated_text || data[0].text || '';
        } else if (data.generated_text) {
            botResponse = data.generated_text;
        } else if (data[0]?.generated_text) {
            botResponse = data[0].generated_text;
        } else {
            // Fallback: try to extract text from response
            botResponse = JSON.stringify(data);
        }

        // Clean up the response (remove the prompt if it was included)
        botResponse = botResponse.replace(prompt, '').trim();
        
        // If response is empty, provide a fallback
        if (!botResponse || botResponse.length === 0) {
            botResponse = "I'm not sure how to respond to that. Could you rephrase?";
        }

        return botResponse;
    } catch (error) {
        console.error('Chatbot API Error:', error);
        throw error;
    }
}

// ============================================
// Message Handling
// ============================================

async function sendMessage() {
    const text = messageInput.value.trim();

    if (text === '') {
        return;
    }

    // Disable input while processing
    messageInput.disabled = true;
    sendButton.disabled = true;

    // Add user's message to UI
    const userMessage = createMessage(text, true);
    messagesContainer.appendChild(userMessage);

    // Add to conversation history
    conversationHistory.push({ role: 'user', text: text });

    // Clear input
    messageInput.value = '';

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Show loading indicator
    const loadingIndicator = createLoadingIndicator();
    messagesContainer.appendChild(loadingIndicator);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    try {
        // Get chatbot response
        const botResponse = await getChatbotResponse(text);

        // Remove loading indicator
        removeLoadingIndicator();

        // Add bot response to UI
        const responseMessage = createMessage(botResponse, false);
        messagesContainer.appendChild(responseMessage);

        // Add to conversation history
        conversationHistory.push({ role: 'assistant', text: botResponse });

        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (error) {
        // Remove loading indicator
        removeLoadingIndicator();

        // Show error message
        let errorMessage = 'Sorry, I encountered an error. ';
        if (error.message.includes('API key')) {
            errorMessage += 'Please configure your Hugging Face API key in app.js';
        } else if (error.message.includes('503') || error.message.includes('loading')) {
            errorMessage += 'The model is still loading. Please try again in a few seconds.';
        } else if (error.message.includes('429')) {
            errorMessage += 'Rate limit exceeded. Please wait a moment before trying again.';
        } else {
            errorMessage += error.message;
        }

        const errorResponse = createMessage(errorMessage, false);
        messagesContainer.appendChild(errorResponse);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } finally {
        // Re-enable input
        messageInput.disabled = false;
        sendButton.disabled = false;
        messageInput.focus();
    }
}

// ============================================
// Event Listeners
// ============================================

sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !messageInput.disabled) {
        sendMessage();
    }
});

// Focus input on load
messageInput.focus();
