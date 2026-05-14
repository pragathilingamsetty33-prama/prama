importScripts("https://www.gstatic.com/firebasejs/9.2.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.2.0/firebase-messaging-compat.js");

const firebaseConfig = {
  apiKey: "AIzaSyDRPDDSjIttxuUBhVDF7B0axqBiOymjPfI",
  authDomain: "prama--chat.firebaseapp.com",
  projectId: "prama--chat",
  storageBucket: "prama--chat.firebasestorage.app",
  messagingSenderId: "354080524856",
  appId: "1:354080524856:web:5a231ab7f4d50963b6f4cd"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("Background Message Received:", payload);
  // We no longer call showNotification here because Firebase handles 
  // the 'notification' payload automatically in the background.
});
