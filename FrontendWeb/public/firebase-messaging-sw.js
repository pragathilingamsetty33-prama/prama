importScripts("https://www.gstatic.com/firebasejs/9.2.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.2.0/firebase-messaging-compat.js");

// Extract params injected during registration
const urlParams = new URL(location.href).searchParams;

const firebaseConfig = {
    apiKey: urlParams.get('apiKey'),
    projectId: urlParams.get('projectId'),
    appId: urlParams.get('appId'),
    messagingSenderId: urlParams.get('senderId'),
    authDomain: `${urlParams.get('projectId')}.firebaseapp.com`,
    storageBucket: `${urlParams.get('projectId')}.firebasestorage.app`
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
});

