# Savor

Savor is a React Native / Expo calorie journal that also builds as a mobile-friendly website. Visitors can scan a meal photo and review an AI estimate of its calories and macros before adding it to their journal.

## Share the app as a website

The included `render.yaml` deploys the Expo web build and AI server together as one Render web service. The frontend and API share an origin, so you only have to send people one HTTPS link.

### Deploy

1. Create a new, empty GitHub repository and push this project to it. With GitHub Desktop, choose **File → New repository**, select this project folder as the local path, create the repository, check that `.env` is not in the changes, and choose **Publish repository**. Alternatively, if Git is installed, use PowerShell:

   ```powershell
   Set-Location -LiteralPath 'D:\New folder\New folder'
   git init
   git add .
   git commit -m "Prepare Savor for web deployment"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/YOUR-REPOSITORY.git
   git push -u origin main
   ```

   Replace the GitHub URL with the empty repository you created. The `.gitignore` excludes `.env`; still check that it is not among the files staged for the commit.
2. In Render, choose **New → Blueprint**, connect that GitHub repository, and apply the `render.yaml` configuration. When Render asks for `OPENAI_API_KEY`, set it as a secret in Render; never commit it to GitHub or set it as an `EXPO_PUBLIC_*` variable.
3. Wait for the deployment to finish, then open the HTTPS `onrender.com` URL shown by Render and share it.

The included Render blueprint uses its free web-service plan. Free services may sleep when idle, so the first visit or scan after inactivity can take a while. AI photo scans also use your OpenAI API account and may incur charges. The server limits each IP address to 10 scans per hour, but this is a basic safeguard, not a billing guarantee. Check your provider's current plan and usage limits before sharing widely.

### What is and isn't shared

- Each browser keeps its own meal journal in local device storage. There is no account, cross-device sync, or shared meal history.
- Browser storage is not encrypted and may be removed when someone clears site data. Do not use it for sensitive health information.
- The server processes uploaded photos in memory and forwards them to OpenAI for analysis; it does not write photos or meal histories to its own storage. Review OpenAI's current privacy and data-retention terms before inviting other people to use the service.
- Nutrition results are estimates, not medical advice. Users should review estimates rather than treating them as exact values.
- This is suitable for a small personal test. A public commercial launch needs stronger abuse prevention, privacy/terms pages, monitoring, and a supported hosting and data-retention plan.

## Run locally

Requirements: Node.js 22.9 or newer and npm.

1. Install dependencies and make a local environment file:

   ```powershell
   npm install
   Copy-Item .env.example .env
   ```

2. Add your OpenAI API key to `OPENAI_API_KEY` in `.env`.
3. To open the website on the same computer, set `EXPO_PUBLIC_API_URL=http://localhost:3000`. For a physical phone, set it to `http://<computer-LAN-IP>:3000` and keep the phone and computer on the same Wi-Fi.
4. Start the API with `npm run server`. Start the app in a second terminal with `npx expo start` (or `npm run web` to run it in a browser).

The local development server also allows localhost web origins. Check `/health` on the server address to confirm it is running and `aiReady` is `true`.

## App features

- Daily calorie goal and remaining-calorie progress
- Protein, carbohydrate, and fat tracking
- Camera capture or photo-library selection
- Photo resizing and JPEG conversion before upload
- Review detected foods and AI-estimated nutrition before saving
- A per-browser, persistent meal journal with daily totals and past dates
