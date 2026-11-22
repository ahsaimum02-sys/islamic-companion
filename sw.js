const CACHE_NAME = 'noor-islamic-app-v4';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json'
];

// ইনস্টল হওয়ার সময় মূল ফাইলগুলো ক্যাশ করা
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// পুরনো ক্যাশ পরিষ্কার করা
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// নেটওয়ার্ক রিকোয়েস্ট হ্যান্ডেল করা ও ক্যাশ আপডেট রাখা
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clonedRes = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clonedRes);
        });
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});