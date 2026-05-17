importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

// 📡 RUNTIME ENVIRONMENT EXTRACTION ENGINE (Hardened Version)
// Extract credentials securely from the active window registration thread parameters
console.log("[firebase-messaging-sw.js] Booting background worker thread...");

const urlParams = new URLSearchParams(self.location.search);

const firebaseConfig = {
  apiKey: urlParams.get('apiKey'),
  authDomain: urlParams.get('authDomain'),
  projectId: urlParams.get('projectId'),
  storageBucket: urlParams.get('storageBucket'),
  messagingSenderId: urlParams.get('messagingSenderId'),
  appId: urlParams.get('appId')
};

// 📊 Integrity Tripwire: Ensure critical keys are present before initialization
if (!firebaseConfig.projectId || !firebaseConfig.apiKey || !firebaseConfig.appId) {
    console.error("CRITICAL ERROR: Missing configuration parameters in query string!");
} else {
    console.log("Configuration extracted successfully. Project:", firebaseConfig.projectId);
}

try {
    // Instantiate context dynamically 
    firebase.initializeApp(firebaseConfig);
    const messaging = firebase.messaging();

    // Background Push Receiver
    messaging.onBackgroundMessage((payload) => {
      console.log('[firebase-messaging-sw.js] Received background message ', payload);
      
      const notificationTitle = payload.notification ? payload.notification.title : "New Message";
      const notificationOptions = {
        body: payload.notification ? payload.notification.body : "You have received a secure message.",
        icon: '/favicon.svg'
      };

      self.registration.showNotification(notificationTitle, notificationOptions);
    });
} catch (err) {
    console.error("Background initialization failed:", err.message);
}
