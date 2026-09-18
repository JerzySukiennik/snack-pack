// Lazy Firebase loader (shared gzowos-games project, everything under snackPack/).
// The web config is a public client identifier, not a secret; security lives in the rules.

const firebaseConfig = {
  apiKey: 'AIzaSyAaTuELH_mToxH3hRJ4WPIVTECSH7Z8-FY',
  authDomain: 'gzowos-games.firebaseapp.com',
  databaseURL: 'https://gzowos-games-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'gzowos-games',
  storageBucket: 'gzowos-games.firebasestorage.app',
  messagingSenderId: '658227201482',
  appId: '1:658227201482:web:627b44e3c4c2988bc4bb33',
};

const CDN = 'https://www.gstatic.com/firebasejs/10.12.5';
export const ROOT = 'snackPack';
let pending = null;

function timeout(promise, ms, label) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label + ' timed out')), ms); })]).finally(() => clearTimeout(t));
}

async function load() {
  const [appMod, authMod, db] = await timeout(Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-database.js`),
  ]), 9000, 'Firebase SDK');
  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
  const auth = authMod.getAuth(app);
  await timeout(auth.authStateReady(), 6000, 'Auth state');
  const user = auth.currentUser || (await timeout(authMod.signInAnonymously(auth), 8000, 'Anonymous sign-in')).user;
  const database = db.getDatabase(app);
  return { uid: user.uid, db, ref: (path) => db.ref(database, `${ROOT}/${path}`) };
}

export function getFirebase() {
  if (!pending) pending = load().catch((e) => { pending = null; throw e; });
  return pending;
}
