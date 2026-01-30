// Get elements
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const messagesContainer = document.getElementById('messagesContainer');
const scrollToInputBtn = document.getElementById('scrollToInputBtn');
const inputArea = document.querySelector('.input-area');
const aiButton = document.getElementById('aiButton');
const aiSuggestionsPanel = document.getElementById('aiSuggestionsPanel');
const closeSuggestionsBtn = document.getElementById('closeSuggestionsBtn');
const aiSuggestionItems = document.querySelectorAll('.ai-suggestion-item');

// Format timestamp
function formatTimestamp() {
    const now = new Date();
    return now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

// Set welcome message timestamp
document.getElementById('welcomeTimestamp').textContent = formatTimestamp();

// Check if input area is visible in viewport
function isInputVisible() {
    const rect = inputArea.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;

    // Check if at least 50% of the input area is visible
    return (rect.top >= 0 && rect.bottom <= windowHeight) ||
           (rect.top < windowHeight && rect.bottom > windowHeight * 0.5);
}

// Toggle scroll button visibility
function toggleScrollButton() {
    if (!isInputVisible() && window.innerHeight < 700) {
        scrollToInputBtn.classList.add('visible', 'pulse');
    } else {
        scrollToInputBtn.classList.remove('visible', 'pulse');
    }
}

// Scroll input into view function
function scrollToInput() {
    // Wait a brief moment for keyboard to appear on mobile
    setTimeout(() => {
        inputArea.scrollIntoView({
            behavior: 'smooth',
            block: 'end',
            inline: 'nearest'
        });

        // Hide the scroll button once scrolled
        setTimeout(() => {
            toggleScrollButton();
        }, 500);
    }, 300);
}

// Add bounce animation to input on focus/click
messageInput.addEventListener('focus', function() {
    this.classList.remove('bounce');
    // Force reflow to restart animation
    void this.offsetWidth;
    this.classList.add('bounce');

    // Scroll to input
    scrollToInput();
});

messageInput.addEventListener('click', function() {
    this.classList.remove('bounce');
    // Force reflow to restart animation
    void this.offsetWidth;
    this.classList.add('bounce');

    // Scroll to input
    scrollToInput();
});

// Remove bounce class after animation completes
messageInput.addEventListener('animationend', function() {
    this.classList.remove('bounce');
});

// Handle window resize (for mobile keyboard appearing)
window.addEventListener('resize', function() {
    if (document.activeElement === messageInput) {
        scrollToInput();
    }
    toggleScrollButton();
});

// Send message function
function sendMessage() {
    const messageText = messageInput.value.trim();

    if (messageText === '') {
        return;
    }

    // Add sending animation to button
    sendButton.classList.add('sending');

    // Create message element
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message own-message';

    const messageBubble = document.createElement('div');
    messageBubble.className = 'message-bubble';

    const messageP = document.createElement('p');
    messageP.textContent = messageText;

    const timestamp = document.createElement('span');
    timestamp.className = 'message-timestamp';
    timestamp.textContent = formatTimestamp();

    messageBubble.appendChild(messageP);
    messageDiv.appendChild(messageBubble);
    messageDiv.appendChild(timestamp);

    // Add message to container
    messagesContainer.appendChild(messageDiv);

    // Clear input
    messageInput.value = '';

    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Remove sending animation after it completes
    setTimeout(() => {
        sendButton.classList.remove('sending');
    }, 400);
}

// Send button click handler
sendButton.addEventListener('click', sendMessage);

// Enter key handler
messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

// Auto-resize textarea behavior (optional enhancement)
messageInput.addEventListener('input', function() {
    // You can add auto-resize logic here if needed
});

// Scroll to input button click handler
scrollToInputBtn.addEventListener('click', function() {
    scrollToInput();
    messageInput.focus();
});

// Check scroll button visibility on scroll
document.addEventListener('scroll', toggleScrollButton);
window.addEventListener('scroll', toggleScrollButton);
messagesContainer.addEventListener('scroll', toggleScrollButton);

// Initial check for scroll button
toggleScrollButton();

// ===== AI Suggestions Functionality =====

// Toggle AI suggestions panel
function toggleAISuggestions() {
    const isVisible = aiSuggestionsPanel.classList.contains('visible');

    if (isVisible) {
        hideAISuggestions();
    } else {
        showAISuggestions();
    }
}

// Show AI suggestions panel
function showAISuggestions() {
    aiSuggestionsPanel.classList.add('visible');
    aiButton.classList.add('active');
}

// Hide AI suggestions panel
function hideAISuggestions() {
    aiSuggestionsPanel.classList.remove('visible');
    aiButton.classList.remove('active');
}

// AI button click handler
aiButton.addEventListener('click', function(e) {
    e.stopPropagation();
    toggleAISuggestions();
});

// Close button handler
closeSuggestionsBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    hideAISuggestions();
});

// AI button hover handler (for desktop)
if (window.matchMedia('(hover: hover)').matches) {
    aiButton.addEventListener('mouseenter', function() {
        showAISuggestions();
    });

    // Keep panel open when hovering over it
    aiSuggestionsPanel.addEventListener('mouseenter', function() {
        showAISuggestions();
    });

    // Close when mouse leaves both button and panel
    let hoverTimeout;
    aiButton.addEventListener('mouseleave', function() {
        hoverTimeout = setTimeout(() => {
            if (!aiSuggestionsPanel.matches(':hover')) {
                hideAISuggestions();
            }
        }, 200);
    });

    aiSuggestionsPanel.addEventListener('mouseleave', function() {
        hoverTimeout = setTimeout(() => {
            if (!aiButton.matches(':hover')) {
                hideAISuggestions();
            }
        }, 200);
    });
}

// Handle AI suggestion clicks
aiSuggestionItems.forEach((item, index) => {
    item.addEventListener('click', function() {
        const suggestionNumber = this.getAttribute('data-suggestion');
        const suggestionText = this.querySelector('.suggestion-text').textContent;

        // Insert the suggestion text into the message input
        messageInput.value = suggestionText;

        // Focus on the input
        messageInput.focus();

        // Hide the suggestions panel
        hideAISuggestions();

        // Optional: Add a visual feedback
        this.style.transform = 'scale(0.95)';
        setTimeout(() => {
            this.style.transform = '';
        }, 200);
    });
});

// Close panel when clicking outside
document.addEventListener('click', function(e) {
    if (!aiSuggestionsPanel.contains(e.target) &&
        !aiButton.contains(e.target)) {
        hideAISuggestions();
    }
});

// Close panel when pressing Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && aiSuggestionsPanel.classList.contains('visible')) {
        hideAISuggestions();
    }
});
