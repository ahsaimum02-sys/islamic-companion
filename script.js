// ট্যাব পরিবর্তনের ফাংশন
function openTab(tabId, event) {
    const contents = document.querySelectorAll('.tab-content');
    const buttons = document.querySelectorAll('.tab-btn');

    contents.forEach((content) => content.classList.remove('active'));
    buttons.forEach((btn) => btn.classList.remove('active'));

    const targetTab = document.getElementById(tabId);
    if (targetTab) {
        targetTab.classList.add('active');
    }
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    } else {
        buttons.forEach((btn) => {
            const attr = btn.getAttribute('onclick') || '';
            if (attr.includes(`'${tabId}'`)) {
                btn.classList.add('active');
            }
        });
    }

    if (tabId === 'qibla') {
        const selectEl = document.getElementById('district-select');
        updateQiblaDisplayForDistrict(selectEl ? selectEl.value : 'Dhaka');
    }
}

// ডার্ক/লাইট মোড টগল
const themeToggle = document.getElementById('theme-toggle');
if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
    });
}

// বাংলাদেশের প্রধান বিভাগ/জেলার স্থানাঙ্ক ও রমজান ২০২৭ সেহরি/ইফতার অফসেট (মিনিটে)
const DISTRICT_COORDS = {
    Dhaka: { bn: 'ঢাকা', lat: 23.8103, lon: 90.4125, offsetMin: 0 },
    Chittagong: { bn: 'চট্টগ্রাম', lat: 22.3569, lon: 91.7832, offsetMin: -5 },
    Sylhet: { bn: 'সিলেট', lat: 24.8949, lon: 91.8687, offsetMin: -6 },
    Rajshahi: { bn: 'রাজশাহী', lat: 24.3745, lon: 88.6042, offsetMin: 7 },
    Khulna: { bn: 'খুলনা', lat: 22.8456, lon: 89.5403, offsetMin: 3 },
    Barisal: { bn: 'বরিশাল', lat: 22.7010, lon: 90.3535, offsetMin: 0 },
    Rangpur: { bn: 'রংপুর', lat: 25.7439, lon: 89.2752, offsetMin: 4 },
    Mymensingh: { bn: 'ময়মনসিংহ', lat: 24.7471, lon: 90.4203, offsetMin: 0 }
};

// কাবা শরীফ (মক্কা)-এর স্থানাঙ্ক
const KAABA_LAT = 21.4225;
const KAABA_LON = 39.8262;

const ALARM_STORAGE_KEY = 'noor_prayer_alarm_enabled_v1';
const LAST_AUTO_DISTRICT_KEY = 'noor_last_auto_district_v1';

let currentQiblaBearing = 278;
let smoothedHeading = null;
let compassListenerActive = false;
let prayerAlarmEnabled = localStorage.getItem(ALARM_STORAGE_KEY) === 'true';
let triggeredAlarmKeys = new Set();
let alarmScheduleItems = [];
let activeCoordsOverride = null;

// পূর্ণাঙ্গ সূরা অডিও (ইয়াসির আল-দাওসারি) ফলব্যাক স্টেট
let activeAudioSources = [];
let activeSourceIndex = 0;
let surahAudioErrorBound = false;

function toRadians(deg) {
    return (deg * Math.PI) / 180;
}

function toDegrees(rad) {
    return (rad * 180) / Math.PI;
}

// দুই স্থানাঙ্কের মধ্যবর্তী দূরত্ব (কিমি)
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) *
            Math.cos(toRadians(lat2)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// প্রদত্ত lat/lon অনুযায়ী সবচেয়ে কাছের জেলা খুঁজে বের করা
function findNearestDistrictKey(lat, lon) {
    let nearestKey = 'Dhaka';
    let minDist = Infinity;

    Object.entries(DISTRICT_COORDS).forEach(([key, info]) => {
        const dist = calculateDistanceKm(lat, lon, info.lat, info.lon);
        if (dist < minDist) {
            minDist = dist;
            nearestKey = key;
        }
    });

    return nearestKey;
}

// কোনো স্থানাঙ্ক থেকে কাবার দিক হিসাব
function calculateQiblaBearing(lat, lon) {
    const phi1 = toRadians(lat);
    const phi2 = toRadians(KAABA_LAT);
    const deltaLambda = toRadians(KAABA_LON - lon);

    const y = Math.sin(deltaLambda) * Math.cos(phi2);
    const x =
        Math.cos(phi1) * Math.sin(phi2) -
        Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

    return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function updateQiblaDisplayForDistrict(districtKey) {
    const info = DISTRICT_COORDS[districtKey] || DISTRICT_COORDS.Dhaka;
    const qLat = activeCoordsOverride ? activeCoordsOverride.lat : info.lat;
    const qLon = activeCoordsOverride ? activeCoordsOverride.lon : info.lon;

    currentQiblaBearing = calculateQiblaBearing(qLat, qLon);
    const roundedDeg = Math.round(currentQiblaBearing);

    const locLabel = document.getElementById('qibla-location-label');
    const degText = document.getElementById('qibla-degree-text');
    const pointer = document.getElementById('qibla-pointer');

    if (locLabel) {
        locLabel.textContent = `নির্বাচিত জেলা: ${info.bn}`;
    }
    if (degText) {
        degText.textContent = `কিবলা কোণ: উত্তর থেকে ${roundedDeg}° (পশ্চিম-উত্তর-পশ্চিম)`;
    }
    if (pointer && !compassListenerActive) {
        pointer.style.transform = `rotate(${currentQiblaBearing}deg)`;
    }
}

function smoothAngle(prev, next, alpha = 0.25) {
    if (prev === null) return next;
    let diff = ((next - prev + 540) % 360) - 180;
    return (prev + diff * alpha + 360) % 360;
}

function handleDeviceOrientation(event) {
    let rawHeading = null;

    if (typeof event.webkitCompassHeading === 'number' && !isNaN(event.webkitCompassHeading)) {
        rawHeading = event.webkitCompassHeading;
    } else if (typeof event.alpha === 'number' && !isNaN(event.alpha)) {
        rawHeading = (360 - event.alpha) % 360;
    }

    if (rawHeading === null) return;

    smoothedHeading = smoothAngle(smoothedHeading, rawHeading, 0.28);
    const heading = smoothedHeading;

    const pointer = document.getElementById('qibla-pointer');
    const ring = document.getElementById('compass-ring');
    const statusEl = document.getElementById('compass-status');

    const relativeQiblaAngle = (currentQiblaBearing - heading + 360) % 360;
    const signedDiff = ((relativeQiblaAngle + 180) % 360) - 180;
    const isAligned = Math.abs(signedDiff) <= 6;

    if (pointer) {
        pointer.style.transform = `rotate(${relativeQiblaAngle}deg)`;
    }

    if (ring) {
        ring.style.borderColor = isAligned ? '#10b981' : 'rgba(251, 191, 36, 0.45)';
        ring.style.boxShadow = isAligned
            ? 'inset 0 0 26px rgba(16, 185, 129, 0.35), 0 0 24px rgba(16, 185, 129, 0.55)'
            : 'inset 0 0 24px rgba(0, 0, 0, 0.6), 0 10px 28px rgba(0, 0, 0, 0.35)';
    }

    if (statusEl) {
        if (isAligned) {
            statusEl.textContent = `✅ এখন সঠিক কিবলার দিকে মুখ করা আছে! (কিবলা: ${Math.round(currentQiblaBearing)}°)`;
        } else if (signedDiff > 0) {
            statusEl.textContent = `ফোনটি ডানদিকে প্রায় ${Math.round(Math.abs(signedDiff))}° ঘোরান • কিবলা: ${Math.round(currentQiblaBearing)}°`;
        } else {
            statusEl.textContent = `ফোনটি বামদিকে প্রায় ${Math.round(Math.abs(signedDiff))}° ঘোরান • কিবলা: ${Math.round(currentQiblaBearing)}°`;
        }
    }
}

function bindOrientationEvent() {
    if (compassListenerActive) return;

    if ('ondeviceorientationabsolute' in window) {
        window.addEventListener('deviceorientationabsolute', handleDeviceOrientation, true);
    }
    window.addEventListener('deviceorientation', handleDeviceOrientation, true);
    compassListenerActive = true;
}

async function requestCompassPermission() {
    const statusEl = document.getElementById('compass-status');

    if (!('DeviceOrientationEvent' in window)) {
        if (statusEl) {
            statusEl.textContent = 'এই ডিভাইসে কম্পাস সেন্সর পাওয়া যায়নি। তবে উপরের কোণ (ডিগ্রি) অনুযায়ী কিবলার দিক নির্ণয় করতে পারবেন।';
        }
        return;
    }

    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
            const response = await DeviceOrientationEvent.requestPermission();
            if (response === 'granted') {
                bindOrientationEvent();
                if (statusEl) {
                    statusEl.textContent = 'কম্পাস চালু হয়েছে। ফোনটি সমতল রেখে ঘোরান।';
                }
            } else if (statusEl) {
                statusEl.textContent = 'কম্পাস পারমিশন দেওয়া হয়নি। পুনরায় ক্লিক করে অনুমতি দিন।';
            }
        } catch (err) {
            if (statusEl) {
                statusEl.textContent = 'কম্পাস অনুমতির সময় সমস্যা হয়েছে।';
            }
        }
    } else {
        bindOrientationEvent();
        if (statusEl) {
            statusEl.textContent = 'লাইভ কম্পাস সক্রিয় করা হয়েছে। ফোনটি সমতল রেখে ঘোরান।';
        }
    }
}

// সময় ফরম্যাট ও হিসাবের হেল্পার
function parseTimeToMinutes(timeStr) {
    if (!timeStr) return null;
    const clean = timeStr.replace(/\s*\(.*?\)/g, '').trim().slice(0, 5);
    const parts = clean.split(':');
    if (parts.length < 2) return null;
    const hours = parseInt(parts[0], 10);
    const mins = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(mins)) return null;
    return hours * 60 + mins;
}

function formatMinutesTo12Hr(totalMins) {
    const normalized = ((totalMins % 1440) + 1440) % 1440;
    let hours24 = Math.floor(normalized / 60);
    const mins = normalized % 60;
    const period = hours24 >= 12 ? 'PM' : 'AM';
    let hours12 = hours24 % 12;
    if (hours12 === 0) hours12 = 12;
    return `${hours12}:${String(mins).padStart(2, '0')} ${period}`;
}

// নামাজের সময়সূচি লোড (Aladhan API)
async function loadPrayerTimes() {
    const selectEl = document.getElementById('district-select');
    const container = document.getElementById('prayer-times-container');
    const hijriEl = document.getElementById('hijri-date');
    const dateEl = document.getElementById('current-date');

    const districtKey = selectEl ? selectEl.value : 'Dhaka';
    const districtInfo = DISTRICT_COORDS[districtKey] || DISTRICT_COORDS.Dhaka;
    const queryLat = activeCoordsOverride ? activeCoordsOverride.lat : districtInfo.lat;
    const queryLon = activeCoordsOverride ? activeCoordsOverride.lon : districtInfo.lon;

    if (container) {
        container.innerHTML = '<div class="loading">সময়সূচি লোড হচ্ছে...</div>';
    }

    try {
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = now.getFullYear();

        const res = await fetch(
            `https://api.aladhan.com/v1/timings/${dd}-${mm}-${yyyy}?latitude=${queryLat}&longitude=${queryLon}&method=1`
        );
        const data = await res.json();

        if (data.code !== 200 || !data.data) {
            throw new Error('Failed to load prayer times');
        }

        const timings = data.data.timings;
        const hijri = data.data.date.hijri;
        const readableDate = data.data.date.readable;

        if (hijriEl) {
            hijriEl.textContent = `${hijri.day} ${hijri.month.en}, ${hijri.year} হিজরি`;
        }
        if (dateEl) {
            dateEl.textContent = `${readableDate} (${districtInfo.bn} • অটো লোকেশন)`;
        }

        const prayers = [
            { key: 'Fajr', name: 'ফজর (সেহরি শেষ)', nextKey: 'Sunrise' },
            { key: 'Sunrise', name: 'সূর্যোদয়', isNonWaqt: true },
            { key: 'Dhuhr', name: 'যোহর', nextKey: 'Asr' },
            { key: 'Asr', name: 'আসর', nextKey: 'Maghrib' },
            { key: 'Maghrib', name: 'মাগরিব (ইফতার)', nextKey: 'Isha' },
            { key: 'Isha', name: 'ইশা', nextKey: 'Fajr' }
        ];

        alarmScheduleItems = [];
        let gridHtml = '';

        prayers.forEach((p) => {
            const rawTime = timings[p.key];
            const displayTime = formatMinutesTo12Hr(parseTimeToMinutes(rawTime));
            let subNote = '';

            if (p.key === 'Sunrise') {
                subNote = 'নিষিদ্ধ সময় শুরু';
            } else if (p.nextKey) {
                let endMins = parseTimeToMinutes(timings[p.nextKey]);
                if (p.key === 'Isha' && endMins <= parseTimeToMinutes(rawTime)) {
                    endMins += 1440;
                }
                const alarmMins = endMins - 30;
                const alarmTimeFormatted = formatMinutesTo12Hr(alarmMins);
                subNote = `🔔 অ্যালার্ম: ${alarmTimeFormatted}`;

                alarmScheduleItems.push({
                    waqtName: p.name,
                    alarmMins: ((alarmMins % 1440) + 1440) % 1440,
                    alarmLabel: alarmTimeFormatted
                });
            }

            gridHtml += `
                <div class="prayer-box">
                    <h4>${p.name}</h4>
                    <p>${displayTime}</p>
                    <small>${subNote}</small>
                </div>
            `;
        });

        if (container) {
            container.innerHTML = gridHtml;
        }
    } catch (error) {
        if (container) {
            container.innerHTML = '<div class="card"><p>নামাজের সময়সূচি লোড করা যায়নি। ইন্টারনেট সংযোগ যাচাই করুন।</p></div>';
        }
    }
}

// ওয়াক্ত শেষ হওয়ার ৩০ মিনিট আগে অ্যালার্ম ফাংশন (স্থায়ীভাবে localStorage-এ সংরক্ষিত)
function syncAlarmUI() {
    const btn = document.getElementById('alarm-toggle-btn');
    const statusText = document.getElementById('alarm-status-text');

    if (prayerAlarmEnabled) {
        if (btn) {
            btn.textContent = 'চালু আছে ✓';
            btn.classList.add('active');
        }
        if (statusText) {
            statusText.textContent = 'সবসময় চালু আছে: প্রতি ওয়াক্ত শেষের ৩০ মিনিট আগে অ্যালার্ম বাজবে';
        }
    } else {
        if (btn) {
            btn.textContent = 'চালু করুন';
            btn.classList.remove('active');
        }
        if (statusText) {
            statusText.textContent = 'বর্তমানে বন্ধ আছে (চালু করতে বাটনে ক্লিক করুন)';
        }
    }
}

function togglePrayerAlarm() {
    prayerAlarmEnabled = !prayerAlarmEnabled;
    localStorage.setItem(ALARM_STORAGE_KEY, String(prayerAlarmEnabled));
    syncAlarmUI();

    if (prayerAlarmEnabled && 'Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
    }
}

function playAlarmSound(isTest = false) {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
            const ctx = new AudioCtx();
            const notes = [523.25, 659.25, 783.99];
            notes.forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.15, ctx.currentTime + idx * 0.22);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.22 + 0.45);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(ctx.currentTime + idx * 0.22);
                osc.stop(ctx.currentTime + idx * 0.22 + 0.48);
            });
        }
    } catch (e) {}

    if (isTest) {
        const banner = document.getElementById('alarm-alert-banner');
        const title = document.getElementById('alarm-banner-title');
        const desc = document.getElementById('alarm-banner-desc');
        if (banner && title && desc) {
            title.textContent = '🔔 অ্যালার্ম সাউন্ড টেস্ট';
            desc.textContent = 'ওয়াক্ত শেষ হওয়ার ৩০ মিনিট আগে এভাবেই অ্যালার্ম সতর্কবার্তা দেখাবে।';
            banner.style.display = 'flex';
        }
    }
}

function dismissAlarmBanner() {
    const banner = document.getElementById('alarm-alert-banner');
    if (banner) {
        banner.style.display = 'none';
    }
}

function checkPrayerAlarms() {
    if (!prayerAlarmEnabled || alarmScheduleItems.length === 0) return;

    const now = new Date();
    const currentMins = now.getHours() * 60 + now.getMinutes();
    const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

    alarmScheduleItems.forEach((item) => {
        const uniqueKey = `${dateKey}-${item.waqtName}-${item.alarmMins}`;
        if (currentMins === item.alarmMins && !triggeredAlarmKeys.has(uniqueKey)) {
            triggeredAlarmKeys.add(uniqueKey);
            playAlarmSound(false);

            const banner = document.getElementById('alarm-alert-banner');
            const title = document.getElementById('alarm-banner-title');
            const desc = document.getElementById('alarm-banner-desc');
            if (banner && title && desc) {
                title.textContent = `⚠️ ${item.waqtName} ওয়াক্ত শেষ হতে ৩০ মিনিট বাকি!`;
                desc.textContent = `সময় ${item.alarmLabel} — দ্রুত নামাজ আদায় করে নিন।`;
                banner.style.display = 'flex';
            }

            if ('Notification' in window && Notification.permission === 'granted') {
                try {
                    new Notification(`${item.waqtName} ওয়াক্ত শেষ হতে ৩০ মিনিট বাকি`, {
                        body: 'দ্রুত নামাজ আদায় করে নিন।'
                    });
                } catch (e) {}
            }
        }
    });
}

// রমজান ২০২৭ ক্যালেন্ডার রেন্ডার (৮ ফেব্রুয়ারি ২০২৭ থেকে ৩০ দিন)
function renderRamadan2027Schedule(districtKey) {
    const tbody = document.getElementById('ramadan-table-body');
    const labelEl = document.getElementById('ramadan-district-label');
    const info = DISTRICT_COORDS[districtKey] || DISTRICT_COORDS.Dhaka;

    if (labelEl) {
        labelEl.textContent = `নির্বাচিত জেলা: ${info.bn} • শুরু ৮ ফেব্রুয়ারি ২০২৭ (চাঁদ দেখার সাপেক্ষে ১ দিন পরিবর্তন হতে পারে)`;
    }
    if (!tbody) return;

    const baseStartDate = new Date(2027, 1, 8);
    const baseSehriMins = 5 * 60 + 14;
    const baseIftarMins = 17 * 60 + 50;

    const banglaDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    const toBnNum = (num) => String(num).replace(/\d/g, (d) => banglaDigits[d]);

    let rowsHtml = '';
    for (let day = 1; day <= 30; day++) {
        const d = new Date(baseStartDate);
        d.setDate(baseStartDate.getDate() + (day - 1));

        const dateLabel = d.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });

        const dailyShift = day - 1;
        const sehriMins = baseSehriMins - Math.floor(dailyShift * 0.8) + info.offsetMin;
        const iftarMins = baseIftarMins + Math.floor(dailyShift * 0.5) + info.offsetMin;

        rowsHtml += `
            <tr>
                <td><strong>${toBnNum(day)} রমজান</strong></td>
                <td>${dateLabel}</td>
                <td>${formatMinutesTo12Hr(sehriMins)}</td>
                <td>${formatMinutesTo12Hr(iftarMins)}</td>
            </tr>
        `;
    }

    tbody.innerHTML = rowsHtml;
}

// নির্বাচিত বা অটো-সনাক্ত জেলায় সব ফিচার আপডেট করা
function applyDistrictSelection(districtKey, coords = null, saveAsAuto = false) {
    const safeKey = DISTRICT_COORDS[districtKey] ? districtKey : 'Dhaka';
    const selectEl = document.getElementById('district-select');

    if (coords && typeof coords.lat === 'number' && typeof coords.lon === 'number') {
        activeCoordsOverride = { lat: coords.lat, lon: coords.lon };
    } else {
        activeCoordsOverride = null;
    }

    if (selectEl && selectEl.value !== safeKey) {
        selectEl.value = safeKey;
    }

    if (saveAsAuto) {
        localStorage.setItem(LAST_AUTO_DISTRICT_KEY, safeKey);
    }

    updateQiblaDisplayForDistrict(safeKey);
    renderRamadan2027Schedule(safeKey);
    loadPrayerTimes();
}

function onDistrictChange() {
    const selectEl = document.getElementById('district-select');
    const district = selectEl ? selectEl.value : 'Dhaka';
    applyDistrictSelection(district, null, false);
}

// GPS ও IP ফলব্যাকের মাধ্যমে বর্তমান জেলা স্বয়ংক্রিয়ভাবে নির্ণয়
function detectLocationByIPFallback() {
    fetch('https://ipwho.is/')
        .then((res) => res.json())
        .then((data) => {
            if (data && data.success && typeof data.latitude === 'number' && typeof data.longitude === 'number') {
                const nearest = findNearestDistrictKey(data.latitude, data.longitude);
                applyDistrictSelection(nearest, { lat: data.latitude, lon: data.longitude }, true);
            }
        })
        .catch(() => {});
}

function autoDetectCurrentDistrict() {
    if ('geolocation' in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;
                const nearest = findNearestDistrictKey(lat, lon);
                applyDistrictSelection(nearest, { lat, lon }, true);
            },
            () => {
                detectLocationByIPFallback();
            },
            {
                enableHighAccuracy: false,
                timeout: 8000,
                maximumAge: 300000
            }
        );
    } else {
        detectLocationByIPFallback();
    }
}

// পূর্ণাঙ্গ সূরা অডিও (ইয়াসির আল-দাওসারি) — আয়াতের মাঝে ব্রেক ছাড়া একটানা প্লেব্যাক
function configureContinuousSurahAudio(audioPlayer, surahNumber) {
    if (!audioPlayer) return;

    const paddedNum = String(surahNumber).padStart(3, '0');
    activeAudioSources = [
        `https://download.quranicaudio.com/quran/yasser_ad-dussary/${paddedNum}.mp3`,
        `https://server11.mp3quran.net/yasser/${paddedNum}.mp3`
    ];
    activeSourceIndex = 0;

    audioPlayer.preload = 'metadata';
    audioPlayer.src = activeAudioSources[0];
    audioPlayer.load();

    if (!surahAudioErrorBound) {
        audioPlayer.addEventListener('error', () => {
            if (activeSourceIndex + 1 < activeAudioSources.length) {
                activeSourceIndex += 1;
                audioPlayer.src = activeAudioSources[activeSourceIndex];
                audioPlayer.load();
            }
        });
        surahAudioErrorBound = true;
    }
}

// আল-কুরআন সূরার তালিকা ও আয়াত লোড
let surahListData = [];

async function loadSurahList() {
    const selectEl = document.getElementById('surah-select');
    if (!selectEl) return;

    try {
        const res = await fetch('https://api.alquran.cloud/v1/surah');
        const data = await res.json();

        if (data.code === 200 && Array.isArray(data.data)) {
            surahListData = data.data;
            selectEl.innerHTML = '<option value="">-- একটি সূরা নির্বাচন করুন --</option>';

            data.data.forEach((surah) => {
                const option = document.createElement('option');
                option.value = surah.number;
                option.textContent = `${surah.number}. ${surah.name} (${surah.englishName} - ${surah.numberOfAyahs} আয়াত)`;
                selectEl.appendChild(option);
            });

            selectEl.value = '';
            loadSurah();
        }
    } catch (error) {
        selectEl.innerHTML = '<option value="">সূরার তালিকা লোড করা যায়নি</option>';
    }
}

function stripLeadingBismillah(arabicText) {
    if (!arabicText) return '';
    const bismillahPatterns = [
        /^بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\s*/u,
        /^بِسۡمِ ٱللَّهِ ٱلرَّحۡمَـٰنِ ٱلرَّحِیمِ\s*/u,
        /^بسم الله الرحمن الرحيم\s*/u
    ];

    let cleaned = arabicText.trim();
    for (const pattern of bismillahPatterns) {
        if (pattern.test(cleaned)) {
            cleaned = cleaned.replace(pattern, '').trim();
            break;
        }
    }
    return cleaned;
}

function normalizeFatihaFirstAyah(arabicText) {
    const stripped = stripLeadingBismillah(arabicText);
    if (!stripped) {
        return 'ٱلۡحَمۡدُ لِلَّهِ رَبِّ ٱلۡعَـٰلَمِینَ';
    }
    return stripped;
}

async function loadSurah() {
    const selectEl = document.getElementById('surah-select');
    const ayahContainer = document.getElementById('ayah-container');
    const audioContainer = document.getElementById('audio-container');
    const audioPlayer = document.getElementById('surah-audio');

    if (!selectEl || !ayahContainer) return;

    const surahNumber = parseInt(selectEl.value, 10);
    if (!surahNumber) {
        ayahContainer.innerHTML = '';
        if (audioContainer) audioContainer.style.display = 'none';
        if (audioPlayer) {
            audioPlayer.pause();
            audioPlayer.removeAttribute('src');
        }
        return;
    }

    ayahContainer.innerHTML = '<div class="card"><p>আয়াতগুলো লোড হচ্ছে...</p></div>';

    try {
        const [arabicRes, banglaRes] = await Promise.all([
            fetch(`https://api.alquran.cloud/v1/surah/${surahNumber}/quran-uthmani`),
            fetch(`https://api.alquran.cloud/v1/surah/${surahNumber}/bn.bengali`)
        ]);

        const arabicData = await arabicRes.json();
        const banglaData = await banglaRes.json();

        if (arabicData.code !== 200 || banglaData.code !== 200) {
            throw new Error('API response error');
        }

        const arabicAyahs = arabicData.data.ayahs;
        const banglaAyahs = banglaData.data.ayahs;

        if (audioContainer && audioPlayer) {
            configureContinuousSurahAudio(audioPlayer, surahNumber);
            audioContainer.style.display = 'block';
        }

        let html = '';

        if (surahNumber !== 9) {
            html += `
                <div class="card" style="text-align: center;">
                    <p class="arabic-text" style="text-align: center; margin-bottom: 0.4rem;">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</p>
                    <p class="bangla-text">পরম করুণাময় অসীম দয়ালু আল্লাহর নামে শুরু করছি</p>
                </div>
            `;
        }

        arabicAyahs.forEach((ayah, index) => {
            const realAyahNumber = ayah.numberInSurah;
            let displayArabic = ayah.text;

            if (surahNumber === 1 && realAyahNumber === 1) {
                displayArabic = normalizeFatihaFirstAyah(displayArabic);
            } else if (realAyahNumber === 1) {
                displayArabic = stripLeadingBismillah(displayArabic);
            }

            const banglaMeaning = banglaAyahs[index] ? banglaAyahs[index].text : '';

            html += `
                <div class="ayah-card">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                        <span style="font-weight: 700; color: #fbbf24;">আয়াত ${realAyahNumber}</span>
                    </div>
                    <p class="arabic-text">${displayArabic}</p>
                    <p class="bangla-text">${banglaMeaning}</p>
                </div>
            `;
        });

        ayahContainer.innerHTML = html;
    } catch (error) {
        ayahContainer.innerHTML = '<div class="card"><p>আয়াত লোড করতে সমস্যা হয়েছে। ইন্টারনেট সংযোগ যাচাই করুন।</p></div>';
    }
}

// ডিজিটাল তাসবিহ
let tasbihCount = parseInt(localStorage.getItem('noor_tasbih_count') || '0', 10);

function updateTasbihDisplay() {
    const display = document.getElementById('tasbih-count');
    if (display) {
        display.textContent = tasbihCount;
    }
    localStorage.setItem('noor_tasbih_count', tasbihCount);
}

function incrementTasbih() {
    tasbihCount += 1;
    updateTasbihDisplay();
}

function resetTasbih() {
    tasbihCount = 0;
    updateTasbihDisplay();
}

// দোয়ার পূর্ণ তালিকা
const duaList = [
    {
        title: "ঘুম থেকে ওঠার দোয়া",
        arabic: "الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ",
        bangla: "উচ্চারণ: আলহামদু লিল্লাযী আহইয়ানা বা'দা মা আমাতানা ওয়া ইলাইহিন নুশূর। অর্থ: যাবতীয় প্রশংসা আল্লাহর জন্য, যিনি আমাদের মৃত্যু দেওয়ার পর পুনরায় জীবিত করেছেন এবং তাঁরই কাছে ফিরে যেতে হবে।"
    },
    {
        title: "ঘর থেকে বের হওয়ার দোয়া",
        arabic: "بِسْمِ اللَّهِ تَوَكَّلْتُ عَلَى اللَّهِ وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ",
        bangla: "উচ্চারণ: বিসমিল্লাহি তাওয়াক্কালতু আলাল্লাহি ওয়া লা হাওলা ওয়া লা কুওয়াতা ইল্লা বিল্লাহ। অর্থ: আল্লাহর নামে বের হচ্ছি, আল্লাহর ওপরই ভরসা করলাম; আল্লাহ ছাড়া কোনো ক্ষমতা ও শক্তি নেই।"
    },
    {
        title: "পিতা-মাতার জন্য দোয়া",
        arabic: "رَبِّ ارْحَمْهُمَا كَمَا رَبَّيَانِي صَغِيرًا",
        bangla: "উচ্চারণ: রাব্বির হামহুমা কামা রাব্বায়ানী ছাগীরা। অর্থ: হে আমার প্রতিপালক! তাঁদের উভয়ের প্রতি দয়া করুন, যেমন তাঁরা শৈশবে আমাকে লালন-পালন করেছেন।"
    },
    {
        title: "বিপদ থেকে রক্ষার দোয়া",
        arabic: "حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ",
        bangla: "উচ্চারণ: হাসবুনাল্লাহু ওয়া নি'মাল ওয়াকীল। অর্থ: আমাদের জন্য আল্লাহই যথেষ্ট এবং তিনি কতই না উত্তম কর্মবিধায়ক।"
    },
    {
        title: "মসজিদে প্রবেশের দোয়া",
        arabic: "اللَّهُمَّ افْتَحْ لِي أَبْوَابَ رَحْمَتِكَ",
        bangla: "উচ্চারণ: আল্লাহুম্মাফতাহ লী আবওয়াবা রাহমাতিক। অর্থ: হে আল্লাহ! আমার জন্য আপনার রহমতের দরজাগুলো খুলে দিন।"
    },
    {
        title: "মসজিদ থেকে বের হওয়ার দোয়া",
        arabic: "اللَّهُمَّ إِنِّي أَسْأَلُكَ مِنْ فَضْلِكَ",
        bangla: "উচ্চারণ: আল্লাহুম্মা ইন্নী আসআলুকা মিন ফাদ্বলিক। অর্থ: হে আল্লাহ! নিশ্চয় আমি আপনার অনুগ্রহ প্রার্থনা করছি।"
    },
    {
        title: "বাথরুমে (টয়লেটে) প্রবেশের দোয়া",
        arabic: "اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْخُبُثِ وَالْخَبَائِثِ",
        bangla: "উচ্চারণ: আল্লাহুম্মা ইন্নী আঊযু বিকা মিনাল খুবুসি ওয়াল খাবায়িস। অর্থ: হে আল্লাহ! নিশ্চয় আমি নাপাক জিন ও শয়তান (পুরুষ ও নারী উভয় প্রকার) থেকে আপনার আশ্রয় প্রার্থনা করছি।"
    },
    {
        title: "বাথরুম (টয়লেট) থেকে বের হওয়ার দোয়া",
        arabic: "غُفْرَانَكَ",
        bangla: "উচ্চারণ: গুফরানাকা। অর্থ: হে আল্লাহ! আমি আপনার কাছে ক্ষমা প্রার্থনা করছি।"
    }
];

function renderDuaList() {
    const duaContainer = document.getElementById('dua-list-container');
    if (!duaContainer) return;

    duaContainer.innerHTML = '';
    duaList.forEach((dua) => {
        const card = document.createElement('div');
        card.className = 'dua-card';
        card.innerHTML = `
            <h4>${dua.title}</h4>
            <p class="arabic-text">${dua.arabic}</p>
            <p class="bangla-text">${dua.bangla}</p>
        `;
        duaContainer.appendChild(card);
    });
}

// সারাদিন শেষে অটোমেটিক প্রশ্ন ও আত্মসমালোচনা (মুহাসাবা) বিশ্লেষণ
const REFLECTION_STORAGE_KEY = 'noor_daily_reflections_v1';

function checkEveningAutoPrompt() {
    const banner = document.getElementById('evening-prompt-banner');
    const promptEl = document.getElementById('reflection-auto-prompt');
    if (!banner) return;

    const now = new Date();
    const hour = now.getHours();
    const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const dismissedKey = sessionStorage.getItem('noor_evening_dismissed_date');

    if (hour >= 18 && dismissedKey !== todayKey) {
        banner.style.display = 'flex';
        if (promptEl) {
            promptEl.textContent = 'সন্ধ্যা পেরিয়ে গেছে—আজকের সারাদিন কেমন কাটল? ছোট্ট করে লিখুন, কী ভালো হলো আর কী ভুল হলো।';
        }
    } else {
        banner.style.display = 'none';
    }
}

function dismissEveningPrompt() {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    sessionStorage.setItem('noor_evening_dismissed_date', todayKey);
    const banner = document.getElementById('evening-prompt-banner');
    if (banner) banner.style.display = 'none';
}

function jumpToReflectionTab() {
    dismissEveningPrompt();
    openTab('reflection');
    const input = document.getElementById('daily-summary-input');
    if (input) input.focus();
}

function analyzeDailyEntry(text, flags) {
    const cleanText = (text || '').trim();
    const goodPoints = [];
    const badPoints = [];
    const guidancePoints = [];

    const hasSalahGood = flags.salah || /নামাজ|সালাত|ওয়াক্ত|জামাত|তাহাজ্জুদ|ফজর|যোহর|আসর|মাগরিব|ইশা/.test(cleanText);
    const hasQuranGood = flags.quran || /কুরআন|কোরআন|তিলাওয়াত|জিকির|তাসবিহ|দোয়া|সদকা|দান/.test(cleanText);
    const hasGoodDeed = flags.goodDeed || /ভালো কাজ|সাহায্য|মা|বাবা|পিতা|আম্মা|আব্বা|ক্ষমা|ধৈর্য|পড়াশোনা|কাজ শেষ/.test(cleanText);

    const hasSalahMiss = /নামাজ ছুটে|কাজা|পড়িনি|পড়া হয়নি|ঘুমিয়ে ছিলাম/.test(cleanText);
    const hasTimeWaste = flags.timeWaste || /সময় নষ্ট|অযথা|ফোন|রিলস|গেম|ঘুম|অলস|দেরি/.test(cleanText);
    const hasAngerOrSin = flags.anger || /রাগ|মেজাজ|ঝগড়া|কষ্ট|মিথ্যা|গীবত|পাপ|ভুল|খারাপ|বিরক্ত/.test(cleanText);

    if (hasSalahGood) {
        goodPoints.push('আপনি নামাজ ও ইবাদতের প্রতি যত্নবান ছিলেন—এটি দিনের সবচেয়ে বড় সফলতা।');
        guidancePoints.push('আগামীকালও প্রতিটি ওয়াক্তের শুরুতেই নামাজের প্রস্তুতি নিন, যেন শেষ সময়ের তাড়াহুড়ো না থাকে।');
    }
    if (hasQuranGood) {
        goodPoints.push('কুরআন, দোয়া বা জিকিরের মাধ্যমে অন্তরকে সজীব রাখার চেষ্টা করেছেন।');
        guidancePoints.push('কালও অন্তত ১০–১৫ মিনিট কুরআন বা জিকিরের জন্য নির্দিষ্ট সময় আলাদা রাখুন।');
    }
    if (hasGoodDeed) {
        goodPoints.push('পরিবার, কাজ বা কারও উপকারে ইতিবাচক ভূমিকা রেখেছেন।');
        guidancePoints.push('এই সদাচরণ ও দায়িত্বশীলতা আগামীকালও ধরে রাখার চেষ্টা করুন।');
    }
    if (goodPoints.length === 0) {
        goodPoints.push('দিনশেষে নিজের ভুল-শুদ্ধি খতিয়ে দেখার জন্য যে সময় নিয়েছেন—আত্মশুদ্ধির পথে এটিই একটি ভালো পদক্ষেপ।');
        guidancePoints.push('আগামীকাল দিনের শুরুতেই অন্তত ৩টি ছোট ভালো কাজ (যেমন—সময়মতো নামাজ, কুরআন ও ভালো আচরণ) ঠিক করে নিন।');
    }

    if (hasSalahMiss) {
        badPoints.push('কোনো ওয়াক্তের নামাজ সময়মতো আদায় না হওয়া বা ছুটে যাওয়া একটি বড় ঘাটতি।');
        guidancePoints.push('ছুটে যাওয়া নামাজ থাকলে দ্রুত কাজা আদায় করুন এবং পরের দিন ওয়াক্ত শুরুর আগেই অ্যালার্ম বা রিমাইন্ডার সেট রাখুন।');
    }
    if (hasTimeWaste) {
        badPoints.push('অপ্রয়োজনীয় স্ক্রিন টাইম, অলসতা বা পরিকল্পনার অভাবে মূল্যবান সময়ের অপচয় হয়েছে।');
        guidancePoints.push('আগামীকাল নির্দিষ্ট সময়ে ফোন/সোশ্যাল মিডিয়া বন্ধ রাখার নিয়ম করুন এবং কাজের টু-ডু লিস্ট লিখে রাখুন।');
    }
    if (hasAngerOrSin) {
        badPoints.push('রাগ, অসতর্ক কথা বা এমন কোনো আচরণ হয়েছে যা কারও মনে কষ্ট দিতে পারে বা আমলের ক্ষতি করে।');
        guidancePoints.push('রাগ উঠলে চুপ থাকুন, জায়গা বদলান বা অজু করে নিন—এবং কারও মনে কষ্ট দিয়ে থাকলে ক্ষমা চেয়ে নিন।');
    }
    if (badPoints.length === 0 && cleanText.length > 0) {
        badPoints.push('আপনার লেখায় বড় কোনো স্পষ্ট ভুল ধরা না পড়লেও, সারাদিনের প্রতিটি মুহূর্ত আরও সচেতনভাবে কাজে লাগানোর সুযোগ রয়েছে।');
        guidancePoints.push('আগামীকাল আরও মনোযোগ ও শৃঙ্খলার সাথে দিনটি সাজানোর চেষ্টা করুন।');
    } else if (badPoints.length === 0) {
        badPoints.push('সারাদিনের বিস্তারিত কথা কম থাকায় নির্দিষ্ট ঘাটতিগুলো আলাদা করে চিহ্নিত করা যায়নি।');
    }

    if (cleanText) {
        guidancePoints.push(`আজকের অভিজ্ঞতা ("${cleanText.slice(0, 70)}${cleanText.length > 70 ? '...' : ''}") মাথায় রেখে কালকের পরিকল্পনা সাজান।`);
    }

    let repentanceText =
        'মানুষ মাত্রই ভুল করে; তবে যে ভুল বুঝতে পেরে আল্লাহর কাছে ফিরে আসে, সেই প্রকৃত সফল। আজকের যেসব ঘাটতি বা অসতর্কতা হয়েছে, সেগুলোর জন্য আন্তরিকভাবে অনুতপ্ত হয়ে আল্লাহর কাছে ক্ষমা প্রার্থনা করুন—যাতে আগামীকাল নতুন উদ্যমে সঠিক পথে চলতে পারেন।';

    if (badPoints.length === 1 && !hasSalahMiss && !hasTimeWaste && !hasAngerOrSin) {
        repentanceText =
            'আলহামদুলিল্লাহ, আজকের দিনটি তুলনামূলক ভালো কেটেছে। তবুও অজান্তে হয়ে যাওয়া কোনো ছোট ভুল বা ত্রুটির জন্য আল্লাহর কাছে ইস্তিগফার করুন এবং শুকরিয়া আদায় করুন।';
    }

    return {
        goodPoints,
        badPoints,
        repentanceText,
        guidancePoints
    };
}

function renderReflectionReport(report, summaryText) {
    const box = document.getElementById('reflection-report-box');
    const goodList = document.getElementById('report-good-list');
    const badList = document.getElementById('report-bad-list');
    const repText = document.getElementById('report-repentance-text');
    const guideList = document.getElementById('report-guidance-list');

    if (!box || !goodList || !badList || !repText || !guideList) return;

    goodList.innerHTML = report.goodPoints.map((item) => `<li>${item}</li>`).join('');
    badList.innerHTML = report.badPoints.map((item) => `<li>${item}</li>`).join('');
    repText.textContent = report.repentanceText;
    guideList.innerHTML = report.guidancePoints.map((item) => `<li>${item}</li>`).join('');

    box.style.display = 'block';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function saveReflectionRecord(summaryText, report) {
    const existing = JSON.parse(localStorage.getItem(REFLECTION_STORAGE_KEY) || '[]');
    const now = new Date();
    const entry = {
        id: Date.now(),
        dateText: now.toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric' }),
        timeText: now.toLocaleTimeString('bn-BD', { hour: '2-digit', minute: '2-digit' }),
        summary: summaryText || 'চেকলিস্ট অনুযায়ী সারাদিনের হিসাব',
        goodCount: report.goodPoints.length,
        badCount: report.badPoints.length,
        guidance: report.guidancePoints[0] || ''
    };

    existing.unshift(entry);
    const trimmed = existing.slice(0, 14);
    localStorage.setItem(REFLECTION_STORAGE_KEY, JSON.stringify(trimmed));
    renderReflectionHistory();
}

function renderReflectionHistory() {
    const listEl = document.getElementById('reflection-history-list');
    if (!listEl) return;

    const records = JSON.parse(localStorage.getItem(REFLECTION_STORAGE_KEY) || '[]');
    if (records.length === 0) {
        listEl.innerHTML = '<p class="muted-note">এখনো কোনো দিনের হিসাব সংরক্ষিত নেই।</p>';
        return;
    }

    listEl.innerHTML = records
        .map(
            (rec) => `
            <div class="history-item">
                <div class="history-item-head">
                    <strong>📅 ${rec.dateText}</strong>
                    <span>${rec.timeText}</span>
                </div>
                <p class="bangla-text">${rec.summary}</p>
                <small class="muted-note">আগামী দিনের দিকনির্দেশনা: ${rec.guidance}</small>
            </div>
        `
        )
        .join('');
}

function generateDailyReflection() {
    const inputEl = document.getElementById('daily-summary-input');
    const summaryText = inputEl ? inputEl.value.trim() : '';

    const flags = {
        salah: Boolean(document.getElementById('chk-salah')?.checked),
        quran: Boolean(document.getElementById('chk-quran')?.checked),
        goodDeed: Boolean(document.getElementById('chk-good-deed')?.checked),
        timeWaste: Boolean(document.getElementById('chk-time-waste')?.checked),
        anger: Boolean(document.getElementById('chk-anger')?.checked)
    };

    if (!summaryText && !Object.values(flags).some(Boolean)) {
        alert('দয়া করে সারাদিনের কথা সংক্ষেপে লিখুন অথবা নিচের যেকোনো একটি অপশন নির্বাচন করুন।');
        return;
    }

    const report = analyzeDailyEntry(summaryText, flags);
    renderReflectionReport(report, summaryText);
    saveReflectionRecord(summaryText, report);
}

function clearReflectionForm() {
    const inputEl = document.getElementById('daily-summary-input');
    if (inputEl) inputEl.value = '';
    ['chk-salah', 'chk-quran', 'chk-good-deed', 'chk-time-waste', 'chk-anger'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.checked = false;
    });
    const box = document.getElementById('reflection-report-box');
    if (box) box.style.display = 'none';
}

// পেজ লোড হলে সব ফিচার চালু করা
document.addEventListener('DOMContentLoaded', () => {
    const savedAutoDistrict = localStorage.getItem(LAST_AUTO_DISTRICT_KEY) || 'Dhaka';
    syncAlarmUI();
    applyDistrictSelection(savedAutoDistrict, null, false);
    updateTasbihDisplay();
    renderDuaList();
    loadSurahList();
    renderReflectionHistory();
    checkEveningAutoPrompt();

    // অ্যাপ ওপেন হলেই বর্তমান অবস্থান অনুযায়ী জেলা স্বয়ংক্রিয়ভাবে নির্ণয়
    autoDetectCurrentDistrict();

    setInterval(checkPrayerAlarms, 20000);
    setInterval(checkEveningAutoPrompt, 60000);
});