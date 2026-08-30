# Gmail (Google) login — setup in ~2 minutes

1. Go to the **Google Cloud Console**: https://console.cloud.google.com
2. Create a project (top bar → New Project → name it `fx-coach` → Create).
3. Make sure the project is selected, then open **APIs & Services → OAuth consent screen**.
   - User type: choose **External** (so anyone can sign in).
   - App name: `FX Coach` · your email as "support email".
   - Click through the other optional fields and **Save** (scopes stay at default).
   - Under **Test users** you can add your own email for testing (anyone can use it later once you click "Publish app").
4. Open **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Name: `web`
   - **Authorized redirect URIs** — add exactly this line, with YOUR real domain once the app is online:
     - Dev: `http://localhost:3000/api/auth/google/callback`
     - Live (after Render deploy): `https://YOUR-APP-NAME.onrender.com/api/auth/google/callback`
   - Click **Create** → copy the **Client ID** and **Client Secret**.

5. Put them on the server (Render dashboard → your service → **Environment**):
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=https://YOUR-APP-NAME.onrender.com/api/auth/google/callback
   ```

6. Restart the app. The "Continue with Google" button now works.

> On the free "External" setting, Google shows an "unverified app" warning the first time someone signs in. Clicking **through it is fine** — you can remove it by submitting your app for verification once you grow.