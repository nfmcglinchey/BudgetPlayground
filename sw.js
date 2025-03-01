const CACHE_NAME = 'budget-tracker-cache-v2';
const urlsToCache = [
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  'https://fonts.googleapis.com/css?family=Roboto:400,500,700&display=swap',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://www.gstatic.com/firebasejs/11.3.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/11.3.0/firebase-database-compat.js'
];

// Install event - Cache assets for offline use
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// Activate event - Cleanup old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(cache => cache !== CACHE_NAME)
          .map(cache => caches.delete(cache))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - Serve cached assets & handle offline requests
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
  } else if (event.request.method === 'POST') {
    event.respondWith(handleOfflinePost(event));
  }
});

// Handle offline POST requests (store expenses locally)
async function handleOfflinePost(event) {
  try {
    const response = await fetch(event.request);
    return response;
  } catch {
    const clonedRequest = event.request.clone();
    const expenseData = await clonedRequest.json();
    let offlineExpenses = JSON.parse(localStorage.getItem('offlineExpenses')) || [];
    offlineExpenses.push(expenseData);
    localStorage.setItem('offlineExpenses', JSON.stringify(offlineExpenses));
    return new Response(JSON.stringify({ message: 'Saved offline' }), { status: 201 });
  }
}

// Background Sync - Sync offline expenses when reconnected
self.addEventListener('sync', event => {
  if (event.tag === 'syncExpenses') {
    event.waitUntil(syncExpenses());
  }
});

async function syncExpenses() {
  const offlineExpenses = JSON.parse(localStorage.getItem('offlineExpenses')) || [];
  if (offlineExpenses.length === 0) return;

  for (const expense of offlineExpenses) {
    await fetch('https://budget-data-b9bcc-default-rtdb.firebaseio.com/expenses.json', {
      method: 'POST',
      body: JSON.stringify(expense),
      headers: { 'Content-Type': 'application/json' }
    });
  }

  localStorage.removeItem('offlineExpenses');
}

// Register sync when online again
self.addEventListener('online', () => {
  navigator.serviceWorker.ready.then(registration => {
    registration.sync.register('syncExpenses');
  });
});
