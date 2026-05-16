import { initializeApp, getApps, deleteApp } from "firebase/app";
import { getMessaging, getToken } from "firebase/messaging";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

if (getApps().length > 0) {
    getApps().forEach(a => {
        try { deleteApp(a); } catch(e) {}
    });
}

let app = null;
try {
    app = initializeApp(firebaseConfig);
} catch (appInitErr) {
    console.error("Firebase initialization failed:", appInitErr);
}

let messagingInstance = null;
if (typeof window !== "undefined" && app) {
    try {
        messagingInstance = getMessaging(app);
    } catch (messagingErr) {
        console.error("Messaging binding failed:", messagingErr);
    }
}

export { app };
export const messaging = messagingInstance;
export default app;

// Production Helpers
export const requestForToken = async (accessToken) => {
    if (!messagingInstance) return null;
    try {
      const currentToken = await getToken(messagingInstance, { 
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY 
      });
      if (currentToken) {
        await fetch(`${import.meta.env.VITE_API_URL}/api/v1/users/fcm-token`, {
          method: 'POST',
          headers: { 
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + accessToken
          },
          body: JSON.stringify({ fcmToken: currentToken })
        });
        return currentToken;
      }
    } catch (err) {
      console.error("FCM Token retrieval failed:", err);
    }
    return null;
};
