# Email Analyzer
This is a program that scans all my inboxes in my school email and sends me a summary of relevant emails to my personal email
# Details
## Mechanism
This program should be running in the google cloud servers and should be triggered at times stipulated by the following schedule:
    Mon–Fri : 8 AM, 1 PM, 6 PM (EAT)
    Saturday: No emails
    Sunday  : 6 PM only (EAT)
## How It Works
When the triggers go off, the sendEmaildigest() function is executed and combs through the latest emails to see their relevance.

After the relevant emails are found, their contents are fed into an AI model that summarizes the emails to 2 or 3 sentences.

Finally, the emails are put in HTML format and sent to the personal email.
## Setup Instructions
SETUP INSTRUCTIONS (one-time, ~5 min):
1. Go to https://script.google.com
    → Sign in with your SCHOOL email 


    NB: Follow this step if you are using a gmail account
    
2. New Project → paste this whole script

    NB: Create your own .env file to store you credentials
3. Replace "YOUR_GEMINI_API_KEY_HERE" with your free key in your .env file
   
    → Get it at: https://aistudio.google.com → "Get API Key"

    NB: You can use any other API key but modify the code accoringly
   
4. Save (Ctrl+S) → dropdown → "setupTriggers" → ▶ Run
5. Authorize permissions when prompted → Done!