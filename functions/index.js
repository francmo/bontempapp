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
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const db = admin.firestore();

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
