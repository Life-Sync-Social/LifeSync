# Chatbot Setup Guide - Hugging Face Integration

## Quick Start

1. **Get Your Hugging Face API Key**
   - Go to https://huggingface.co/settings/tokens
   - Sign up or log in to your Hugging Face account
   - Click "New token" to create a new API key
   - Copy your API key (starts with `hf_...`)

2. **Configure the API Key**
   - Open `app.js` in the `texting_ui` folder
   - Find the line: `const HUGGING_FACE_API_KEY = 'YOUR_API_KEY_HERE';`
   - Replace `'YOUR_API_KEY_HERE'` with your actual API key:
     ```javascript
     const HUGGING_FACE_API_KEY = 'hf_your_actual_api_key_here';
     ```

3. **Test the Chatbot**
   - Refresh your browser
   - Go to the Texting UI
   - Send a message and wait for the chatbot response!

## Available Models

You can change the model by editing this line in `app.js`:
```javascript
const HUGGING_FACE_MODEL = 'microsoft/DialoGPT-medium';
```

### Recommended Models:

1. **microsoft/DialoGPT-medium** (Default)
   - Good balance of speed and quality
   - Conversational responses
   - ~350M parameters

2. **microsoft/DialoGPT-large**
   - Better quality responses
   - Slower response time
   - ~770M parameters

3. **microsoft/DialoGPT-small**
   - Fastest responses
   - Lower quality
   - ~117M parameters

4. **facebook/blenderbot-400M-distill**
   - Very conversational
   - Good for longer conversations
   - ~400M parameters

5. **google/flan-t5-base**
   - Good at following instructions
   - Task-oriented responses
   - ~250M parameters

## API Limits

### Free Tier:
- **1,000 requests/month** (approximately 33 requests/day)
- Rate limits may apply during peak times
- Models may take 10-30 seconds to load on first request

### Paid Tier:
- Higher rate limits
- Faster response times
- Priority access

## Troubleshooting

### "Please set your Hugging Face API key"
- Make sure you've replaced `YOUR_API_KEY_HERE` with your actual API key
- Check that the API key is wrapped in quotes: `'hf_...'`

### "Model is still loading" (503 Error)
- The model needs to "wake up" on Hugging Face servers
- Wait 10-30 seconds and try again
- This happens on the first request or after inactivity

### "Rate limit exceeded" (429 Error)
- You've exceeded your free tier limit
- Wait a few minutes before trying again
- Consider upgrading to a paid plan

### Empty or weird responses
- Some models may need a few tries to work properly
- Try a different model from the list above
- Check the browser console for detailed error messages

## Advanced Configuration

### Adjust Response Parameters

In `app.js`, you can modify the response parameters:

```javascript
parameters: {
    max_new_tokens: 150,    // Maximum length of response (increase for longer responses)
    temperature: 0.7,       // Creativity (0.1 = conservative, 1.0 = creative)
    top_p: 0.9,            // Diversity of responses
    return_full_text: false // Don't include the prompt in response
}
```

### Conversation History

The chatbot remembers the last 5 messages for context. This helps maintain conversation flow.

## Security Note

⚠️ **Important**: Your API key is visible in the JavaScript code. For production:
- Use a backend server to hide your API key
- Never commit API keys to public repositories
- Use environment variables or secure storage

## Need Help?

- Hugging Face Documentation: https://huggingface.co/docs/api-inference
- Model Hub: https://huggingface.co/models?pipeline_tag=text-generation
- Community Forum: https://discuss.huggingface.co/
