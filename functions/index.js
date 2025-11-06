/**
 * Firebase Cloud Functions per BontempApp
 *
 * Funzione 1: updateLikesCount
 * Aggiorna automaticamente il contatore 'likes' sul documento principale
 * quando un like viene aggiunto o rimosso dalla subcollection.
 *
 * Funzione 2: calculateDailyWinner
 * Schedulata ogni giorno alle 23:59 (Europe/Rome)
 * Calcola la foto con più likes pubblicate nelle ultime 24h
 * e salva il vincitore in configurazioniApp/vincitoreDelGiorno
 *
 * Funzione 3: postComment (CALLABLE)
 * Permette agli utenti autenticati di postare commenti con filtro AI Gemini
 * per bloccare contenuti offensivi (HATE_SPEECH, HARASSMENT, ecc.)
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const {GoogleGenerativeAI, HarmCategory, HarmBlockThreshold} = require('@google/generative-ai');

admin.initializeApp();

const db = admin.firestore();

// Inizializza Gemini AI (la chiave API verrà configurata come variabile d'ambiente)
const genAI = new GoogleGenerativeAI(functions.config().gemini?.api_key || process.env.GEMINI_API_KEY);

/**
 * Trigger: Quando un like viene creato o eliminato nella subcollection
 * Azione: Conta tutti i like nella subcollection e aggiorna il campo 'likes' del post
 */
exports.updateLikesCount = functions.firestore
  .document('pubblicazioni/{pubId}/likes/{userId}')
  .onWrite(async (change, context) => {
    const pubId = context.params.pubId;

    try {
      // Riferimento al documento principale (pubblicazione)
      const postRef = db.collection('pubblicazioni').doc(pubId);

      // Conta tutti i documenti nella subcollection 'likes'
      const likesSnapshot = await postRef.collection('likes').get();
      const likesCount = likesSnapshot.size;

      // Aggiorna il campo 'likes' del documento principale
      await postRef.update({
        likes: likesCount
      });

      console.log(`✅ Post ${pubId}: likes aggiornato a ${likesCount}`);
      return null;

    } catch (error) {
      console.error(`❌ Errore aggiornamento likes per post ${pubId}:`, error);
      return null;
    }
  });

/**
 * Funzione schedulata: Calcola il vincitore del giorno
 * Esecuzione: Ogni giorno alle 23:59 (timezone Europe/Rome)
 * Azione: Trova la foto con più likes pubblicata nelle ultime 24h
 */
exports.calculateDailyWinner = functions
  .pubsub
  .schedule('59 23 * * *') // Cron: ogni giorno alle 23:59
  .timeZone('Europe/Rome')
  .onRun(async (context) => {
    try {
      console.log('🏆 Inizio calcolo vincitore del giorno...');

      // Calcola il timestamp di 24 ore fa
      const now = admin.firestore.Timestamp.now();
      const twentyFourHoursAgo = new admin.firestore.Timestamp(
        now.seconds - (24 * 60 * 60),
        now.nanoseconds
      );

      // Cerca tutte le pubblicazioni create nelle ultime 24h
      const postsSnapshot = await db.collection('pubblicazioni')
        .where('timestamp', '>=', twentyFourHoursAgo)
        .orderBy('timestamp', 'desc')
        .get();

      console.log(`📊 Trovate ${postsSnapshot.size} pubblicazioni nelle ultime 24h`);

      if (postsSnapshot.empty) {
        // Nessuna pubblicazione: salva placeholder
        await db.collection('configurazioniApp').doc('vincitoreDelGiorno').set({
          hasWinner: false,
          message: 'Nessuna pubblicazione oggi',
          calculatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('ℹ️ Nessuna pubblicazione nelle ultime 24h');
        return null;
      }

      // Trova il post con più likes
      let winner = null;
      let maxLikes = -1;

      postsSnapshot.forEach((doc) => {
        const data = doc.data();
        const likes = data.likes || 0;

        // Se ha più likes, diventa il vincitore
        // In caso di pareggio, vince il più recente (primo nell'array già ordinato per timestamp desc)
        if (likes > maxLikes) {
          maxLikes = likes;
          winner = {
            postId: doc.id,
            imageUrl: data.imageUrl,
            thumbnailUrl: data.thumbnailUrl || data.imageUrl,
            likes: likes,
            userName: data.userName || 'Anonimo',
            userPhotoURL: data.userPhotoURL || '',
            timestamp: data.timestamp,
            description: data.description || ''
          };
        }
      });

      // Salva il vincitore in Firestore
      await db.collection('configurazioniApp').doc('vincitoreDelGiorno').set({
        hasWinner: true,
        winner: winner,
        calculatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`🎉 Vincitore del giorno: Post ${winner.postId} con ${winner.likes} likes`);
      return null;

    } catch (error) {
      console.error('❌ Errore calcolo vincitore del giorno:', error);
      return null;
    }
  });

/**
 * Cloud Function CALLABLE: postComment
 * Permette agli utenti autenticati di postare commenti con filtro AI Gemini
 * per bloccare contenuti offensivi
 *
 * Input: { pubId: string, text: string }
 * Output: { success: true } oppure errore
 */
exports.postComment = functions.https.onCall(async (data, context) => {
  // ========== 1. VERIFICA AUTENTICAZIONE ==========
  if (!context.auth) {
    throw new functions.https.HttpsError(
        'unauthenticated',
        'Devi essere autenticato per commentare.'
    );
  }

  // Verifica che NON sia un utente anonimo
  if (context.auth.token.firebase.sign_in_provider === 'anonymous') {
    throw new functions.https.HttpsError(
        'permission-denied',
        'Gli utenti anonimi non possono commentare. Accedi con Google.'
    );
  }

  // ========== 2. VALIDAZIONE INPUT ==========
  const {pubId, text} = data;

  if (!pubId || typeof pubId !== 'string') {
    throw new functions.https.HttpsError(
        'invalid-argument',
        'pubId mancante o non valido.'
    );
  }

  if (!text || typeof text !== 'string') {
    throw new functions.https.HttpsError(
        'invalid-argument',
        'Il testo del commento è obbligatorio.'
    );
  }

  const trimmedText = text.trim();

  if (trimmedText.length === 0) {
    throw new functions.https.HttpsError(
        'invalid-argument',
        'Il commento non può essere vuoto.'
    );
  }

  if (trimmedText.length > 500) {
    throw new functions.https.HttpsError(
        'invalid-argument',
        'Il commento è troppo lungo (max 500 caratteri).'
    );
  }

  // ========== 3. FILTRO AI GEMINI (Livello 1 Sicurezza) ==========
  try {
    console.log('🔄 DEPLOY CHECK: postComment v2.0 - Gemini 2.0 Flash');
    console.log(`🔍 Analisi commento per post ${pubId} da utente ${context.auth.uid}`);

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    });

    // Prompt per analizzare il commento
    const prompt = `Analizza se questo commento rispetta le linee guida della community (no hate speech, no harassment, no contenuti offensivi). Commento: "${trimmedText}". Rispondi solo "SAFE" o "UNSAFE".`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const responseText = response.text().trim().toUpperCase();

    console.log(`🤖 Gemini AI risposta: ${responseText}`);

    // Se Gemini blocca o ritorna UNSAFE, nega il commento
    if (response.promptFeedback?.blockReason || responseText.includes('UNSAFE')) {
      console.log(`⛔ Commento bloccato da Gemini AI per utente ${context.auth.uid}`);
      throw new functions.https.HttpsError(
          'invalid-argument',
          'Il tuo commento viola le linee guida della community.'
      );
    }

    // ========== 4. SALVA IL COMMENTO IN FIRESTORE ==========
    const commentData = {
      text: trimmedText,
      userId: context.auth.uid,
      userName: context.auth.token.name || 'Utente',
      userImage: context.auth.token.picture || null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      flagCount: 0,
      isHidden: false,
    };

    await db.collection('pubblicazioni')
        .doc(pubId)
        .collection('comments')
        .add(commentData);

    console.log(`✅ Commento salvato per post ${pubId} da ${context.auth.token.name}`);

    return {success: true};
  } catch (error) {
    // Se l'errore è già un HttpsError, rilancia
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    // Altrimenti logga e lancia un errore generico
    console.error('❌ Errore in postComment:', error);
    throw new functions.https.HttpsError(
        'internal',
        'Errore durante l\'invio del commento. Riprova.'
    );
  }
});
