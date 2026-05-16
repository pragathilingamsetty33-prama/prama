import { initializeApp, getApps } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
export const storage = getStorage(app);

let messaging = null;
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  try {
    const apiKey = encodeURIComponent(import.meta.env.VITE_FIREBASE_API_KEY);
    const projectId = encodeURIComponent(import.meta.env.VITE_FIREBASE_PROJECT_ID);
    const appId = encodeURIComponent(import.meta.env.VITE_FIREBASE_APP_ID);
    const senderId = encodeURIComponent(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID);
    
    navigator.serviceWorker.register(
      `/firebase-messaging-sw.js?apiKey=${apiKey}&projectId=${projectId}&appId=${appId}&senderId=${senderId}`
    ).catch(err => console.error("SW registration failed", err));

    messaging = getMessaging(app);
  } catch (e) {
    console.warn("Firebase Messaging not supported in this environment (likely due to HTTP)");
  }
}

export { messaging };

export const requestForToken = async (accessToken) => {
  if (!messaging) return null;
  try {
    const currentToken = await getToken(messaging, { 
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
    } else {
      console.log('No registration token available. Request permission to generate one.');
    }
  } catch (err) {
    console.log('An error occurred while retrieving token. ', err);
  }
};

export const onMessageListener = () =>
  new Promise((resolve) => {
    if (!messaging) return;
    onMessage(messaging, (payload) => {
      resolve(payload);
    });
  });
