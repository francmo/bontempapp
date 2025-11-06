/**
 * 🔒 CONFIGURAZIONE FIREBASE API KEY
 *
 * ✅ QUESTA CHIAVE È PUBBLICA ED È SICURO COMMITARLA SU GITHUB
 *
 * Perché è sicuro?
 * 1. Le API key Firebase per web app sono SEMPRE pubbliche (nel bundle JS)
 * 2. La sicurezza è garantita dalle RESTRIZIONI configurate su Google Cloud:
 *    - Referrer limitati (solo bontempapp.soundscapestudio.org)
 *    - API limitate (solo Identity Toolkit, Firestore, Storage, Gemini)
 * 3. Firestore Rules controllano accessi ai dati
 * 4. Storage Rules controllano accessi ai file
 *
 * Fonte: https://firebase.google.com/docs/projects/api-keys
 *
 * ⚠️ IMPORTANTE: Mantieni sempre le restrizioni attive su Google Cloud Console!
 */

const FIREBASE_API_KEY = "AIzaSyDbLvyLZCnlFzmw0wzSYdETO-S6w7bXm2A";
