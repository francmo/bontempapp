/**
 * Firebase Cloud Functions per BontempApp
 *
 * Funzione 1: updateLikesCount
 * Aggiorna automaticamente il contatore 'likes' sul documento principale
 * quando un like viene aggiunto o rimosso dalla subcollection.
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
