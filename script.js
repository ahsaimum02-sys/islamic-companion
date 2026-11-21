// ডার্ক মোড টগল
const themeToggle = document.getElementById('theme-toggle');
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
});

// ট্যাব পরিবর্তন করার ফাংশন
function openTab(tabName, event) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    document.getElementById(tabName).classList.add('active');
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }
}

// সময় থেকে নির্দিষ্ট মিনিট (ডিফল্ট +১ মিনিট, অর্থাৎ ১ মিনিট পিছিয়ে) সমন্বয় করা
function adjustTimeMinutes(time24, offsetMinutes = 1) {
    const cleanTime = time24.trim().split(' ')[0];
    let [hours, minutes] = cleanTime.split(':').map(Number);

    let totalMinutes = hours * 60 + minutes + offsetMinutes;
    totalMinutes = ((totalMinutes % 1440) + 1440) % 1440;

    const newHours = Math.floor(totalMinutes / 60);
    const newMinutes = totalMinutes % 60;

    return `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
}

// ১২-ঘণ্টার ফরম্যাটে সময় রূপান্তর
function formatTime12Hour(time24, offsetMinutes = 1) {
    const adjusted24 = adjustTimeMinutes(time24, offsetMinutes);
    let [hours, minutes] = adjusted24.split(':').map(Number);

    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    return `${hours}:${String(minutes).padStart(2, '0')} ${ampm}`;
}

// --- ওয়াক্ত শেষ হওয়ার ৩০ মিনিট আগে অ্যালার্ম সিস্টেম ---
let isAlarmEnabled = localStorage.getItem('prayerAlarmEnabled') === 'true';
let scheduledAlarms = [];
let triggeredAlarmsToday = new Set();
let lastLoadedDateStr = new Date().toDateString();
let audioCtx = null;

function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

// মিষ্টি অ্যালার্ম টোন বাজানোর ফাংশন (কোনো আলাদা MP3 ছাড়াই কাজ করবে)
function playAlarmSound(isTest = false) {
    initAudioContext();
    const notes = [523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime + i * 0.25);

        gain.gain.setValueAtTime(0.001, audioCtx.currentTime + i * 0.25);
        gain.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + i * 0.25 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.25 + 0.6);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(audioCtx.currentTime + i * 0.25);
        osc.stop(audioCtx.currentTime + i * 0.25 + 0.65);
    });

    if (isTest) {
        showAlarmBanner(
            "🔔 অ্যালার্ম টেস্ট সফল হয়েছে!",
            "প্রতি ওয়াক্ত শেষ হওয়ার ৩০ মিনিট আগে ঠিক এভাবেই অ্যালার্ম বাজবে।"
        );
    }
}

function updateAlarmUI() {
    const btn = document.getElementById('alarm-toggle-btn');
    const statusText = document.getElementById('alarm-status-text');
    if (isAlarmEnabled) {
        btn.innerText = 'চালু আছে ✓';
        btn.classList.add('active');
        statusText.innerText = 'সক্রিয়: প্রতি ওয়াক্ত শেষের ৩০ মিনিট আগে অ্যালার্ম বাজবে';
    } else {
        btn.innerText = 'চালু করুন';
        btn.classList.remove('active');
        statusText.innerText = 'বর্তমানে বন্ধ আছে (চালু করতে বাটনে ক্লিক করুন)';
    }
}

function togglePrayerAlarm() {
    isAlarmEnabled = !isAlarmEnabled;
    localStorage.setItem('prayerAlarmEnabled', isAlarmEnabled);
    if (isAlarmEnabled) {
        initAudioContext();
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }
        playAlarmSound(false);
    }
    updateAlarmUI();
}

function showAlarmBanner(title, desc) {
    const banner = document.getElementById('alarm-alert-banner');
    document.getElementById('alarm-banner-title').innerText = title;
    document.getElementById('alarm-banner-desc').innerText = desc;
    banner.style.display = 'flex';
}

function dismissAlarmBanner() {
    document.getElementById('alarm-alert-banner').style.display = 'none';
}

// প্রতি ১০ সেকেন্ড পরপর চেক করা যে কোনো ওয়াক্ত শেষ হতে ৩০ মিনিট বাকি কি না এবং তারিখ বদলেছে কি না
function checkAlarmsAndDate() {
    const now = new Date();

    // রাত ১২টার পর নতুন দিন শুরু হলে অটোমেটিক নতুন দিনের নামাজের সময়সূচি লোড করা
    if (now.toDateString() !== lastLoadedDateStr) {
        lastLoadedDateStr = now.toDateString();
        triggeredAlarmsToday.clear();
        fetchPrayerTimes();
        return;
    }

    if (!isAlarmEnabled || scheduledAlarms.length === 0) return;

    const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    scheduledAlarms.forEach(alarm => {
        const alarmKey = `${lastLoadedDateStr}-${alarm.prayerName}`;
        if (alarm.alarmTime24 === currentHHMM && !triggeredAlarmsToday.has(alarmKey)) {
            triggeredAlarmsToday.add(alarmKey);
            playAlarmSound(false);

            const title = `⚠️ ${alarm.prayerName}-এর ওয়াক্ত শেষ হতে ৩০ মিনিট বাকি!`;
            const desc = `${alarm.endTime12}-এ ${alarm.prayerName}-এর সময় শেষ হয়ে যাবে। ব্যস্ততা রেখে দ্রুত নামাজ পড়ে নিন।`;

            showAlarmBanner(title, desc);

            if ("Notification" in window && Notification.permission === "granted") {
                new Notification(title, { body: desc });
            }
        }
    });
}

// ১. নামাজের সময়সূচি লোড করা (Aladhan API)
async function fetchPrayerTimes() {
    const city = document.getElementById('district-select').value;
    const container = document.getElementById('prayer-times-container');
    container.innerHTML = '<div class="loading">সময়সূচি লোড হচ্ছে...</div>';

    try {
        const res = await fetch(`https://api.aladhan.com/v1/timingsByCity?city=${city}&country=Bangladesh&method=1`);
        const data = await res.json();
        const timings = data.data.timings;
        const dateInfo = data.data.date;

        document.getElementById('current-date').innerText = dateInfo.readable;
        document.getElementById('hijri-date').innerText = `${dateInfo.hijri.day} ${dateInfo.hijri.month.en}, ${dateInfo.hijri.year} হিজরি`;

        const prayers = [
            { name: 'ফজর (সেহরি শেষ)', time: timings.Fajr, endTime: timings.Sunrise, hasAlarm: true, alarmLabel: 'ফজর' },
            { name: 'সূর্যোদয়', time: timings.Sunrise, hasAlarm: false },
            { name: 'যোহর', time: timings.Dhuhr, endTime: timings.Asr, hasAlarm: true, alarmLabel: 'যোহর' },
            { name: 'আসর', time: timings.Asr, endTime: timings.Maghrib, hasAlarm: true, alarmLabel: 'আসর' },
            { name: 'মাগরিব (ইফতার)', time: timings.Maghrib, endTime: timings.Isha, hasAlarm: true, alarmLabel: 'মাগরিব' },
            { name: 'ইশা', time: timings.Isha, endTime: timings.Fajr, hasAlarm: true, alarmLabel: 'ইশা' }
        ];

        // ওয়াক্ত শেষ হওয়ার ৩০ মিনিট আগে অ্যালার্ম সিডিউল (+১ মিনিট সমন্বয়সহ শেষ সময় থেকে ৩০ মিনিট বিয়োগ = -২৯ মিনিট)
        scheduledAlarms = prayers
            .filter(p => p.hasAlarm)
            .map(p => ({
                prayerName: p.alarmLabel,
                alarmTime24: adjustTimeMinutes(p.endTime, -29),
                alarmTime12: formatTime12Hour(p.endTime, -29),
                endTime12: formatTime12Hour(p.endTime, 1)
            }));

        container.innerHTML = prayers.map(p => {
            const alarmNote = p.hasAlarm
                ? `<small>🔔 অ্যালার্ম: ${formatTime12Hour(p.endTime, -29)}</small>`
                : `<small>নিষিদ্ধ সময় শুরু</small>`;
            return `
                <div class="prayer-box">
                    <h4>${p.name}</h4>
                    <p>${formatTime12Hour(p.time, 1)}</p>
                    ${alarmNote}
                </div>
            `;
        }).join('');
    } catch (error) {
        container.innerHTML = '<p>ইন্টারনেট সংযোগ পরীক্ষা করুন। সময়সূচি লোড করা যায়নি।</p>';
    }
}

// ২. আল-কুরআনের সূরা তালিকা লোড করা
async function fetchSurahList() {
    const select = document.getElementById('surah-select');
    try {
        const res = await fetch('https://api.alquran.cloud/v1/surah');
        const data = await res.json();

        select.innerHTML = '<option value="">-- একটি সূরা বেছে নিন --</option>' +
            data.data.map(surah => `<option value="${surah.number}">${surah.number}. ${surah.englishName} (${surah.name})</option>`).join('');
    } catch (error) {
        select.innerHTML = '<option>সূরা লোড করতে সমস্যা হয়েছে</option>';
    }
}

// নির্বাচিত সূরার আয়াত ও বাংলা অনুবাদ লোড করা
async function loadSurah() {
    const surahNumber = document.getElementById('surah-select').value;
    const container = document.getElementById('ayah-container');
    const audioContainer = document.getElementById('audio-container');
    const audioPlayer = document.getElementById('surah-audio');

    if (!surahNumber) {
        container.innerHTML = '';
        audioContainer.style.display = 'none';
        return;
    }

    container.innerHTML = '<p>আয়াত লোড হচ্ছে...</p>';
    audioPlayer.src = `https://cdn.islamic.network/quran/audio-surah/128/ar.alafasy/${surahNumber}.mp3`;
    audioContainer.style.display = 'block';

    try {
        const [arabicRes, banglaRes] = await Promise.all([
            fetch(`https://api.alquran.cloud/v1/surah/${surahNumber}`),
            fetch(`https://api.alquran.cloud/v1/surah/${surahNumber}/bn.bengali`)
        ]);

        const arabicData = await arabicRes.json();
        const banglaData = await banglaRes.json();

        const ayahs = arabicData.data.ayahs;
        const translations = banglaData.data.ayahs;

        container.innerHTML = ayahs.map((ayah, index) => `
            <div class="ayah-card">
                <div class="arabic-text">${ayah.text} ﴿${ayah.numberInSurah}﴾</div>
                <div class="bangla-text">${translations[index].text}</div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = '<p>আয়াত লোড করতে সমস্যা হয়েছে।</p>';
    }
}

// ৩. ২০২৭ সালের রমজান ক্যালেন্ডার (সবসময় ৩০টি রোজা নিশ্চিত করার ব্যবস্থা)
async function loadRamadan2027() {
    const tbody = document.getElementById('ramadan-table-body');
    try {
        const [febRes, marRes] = await Promise.all([
            fetch('https://api.aladhan.com/v1/calendarByCity/2027/2?city=Dhaka&country=Bangladesh&method=1'),
            fetch('https://api.aladhan.com/v1/calendarByCity/2027/3?city=Dhaka&country=Bangladesh&method=1')
        ]);

        const febData = await febRes.json();
        const marData = await marRes.json();
        const allDays = [...febData.data, ...marData.data];

        let ramadanDays = allDays.filter(day => day.date.hijri.month.number === 9);

        if (ramadanDays.length > 0 && ramadanDays.length < 30) {
            const lastDayIndex = allDays.findIndex(d => d.date.gregorian.date === ramadanDays[ramadanDays.length - 1].date.gregorian.date);
            if (lastDayIndex !== -1 && allDays[lastDayIndex + 1]) {
                ramadanDays.push(allDays[lastDayIndex + 1]);
            }
        }

        ramadanDays = ramadanDays.slice(0, 30);

        if (ramadanDays.length > 0) {
            tbody.innerHTML = ramadanDays.map((day, index) => `
                <tr>
                    <td><strong>${index + 1} রমজান</strong></td>
                    <td>${day.date.readable}</td>
                    <td>${formatTime12Hour(day.timings.Fajr, 1)}</td>
                    <td>${formatTime12Hour(day.timings.Maghrib, 1)}</td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = '<tr><td colspan="4">তথ্য পাওয়া যায়নি।</td></tr>';
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="4">ক্যালেন্ডার লোড করতে সমস্যা হয়েছে।</td></tr>';
    }
}

// ৪. দোয়া ও তাসবিহ সেকশন
const duas = [
    {
        title: "ঘুম থেকে ওঠার দোয়া",
        arabic: "الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ",
        bangla: "সমস্ত প্রশংসা সেই আল্লাহর জন্য, যিনি আমাদের মৃত্যু (নিদ্রা) দেওয়ার পর জীবিত করলেন এবং তাঁরই কাছে আমাদের ফিরে যেতে হবে।"
    },
    {
        title: "ঘর থেকে বের হওয়ার দোয়া",
        arabic: "بِسْمِ اللَّهِ تَوَكَّلْتُ عَلَى اللَّهِ، وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ",
        bangla: "আল্লাহর নামে বের হচ্ছি, আল্লাহর ওপর ভরসা করলাম। আর আল্লাহর সাহায্য ছাড়া কোনো উপায় ও শক্তি নেই।"
    },
    {
        title: "বিপদ থেকে রক্ষার দোয়া (দোয়া ইউনুস)",
        arabic: "لَا إِلَٰهَ إِلَّا أَنْتَ سُبْحَانَكَ إِنِّي كُنْتُ مِنَ الظَّالِمِينَ",
        bangla: "তুমি ব্যতীত কোনো উপাস্য নেই; তুমি পবিত্র ও মহান! নিশ্চয়ই আমি সীমালঙ্ঘনকারীদের অন্তর্ভুক্ত।"
    },
    {
        title: "পিতা-মাতার জন্য দোয়া",
        arabic: "رَبِّ ارْحَمْهُمَا كَمَا رَبَّيَانِي صَغِيرًا",
        bangla: "হে আমার প্রতিপালক! তাদের উভয়ের প্রতি দয়া করুন, যেভাবে তারা আমাকে শৈশবে লালন-পালন করেছেন।"
    }
];

function renderDuas() {
    const container = document.getElementById('dua-list-container');
    container.innerHTML = duas.map(d => `
        <div class="dua-card">
            <h4>${d.title}</h4>
            <div class="arabic-text">${d.arabic}</div>
            <div class="bangla-text">${d.bangla}</div>
        </div>
    `).join('');
}

let tasbihCount = 0;
function incrementTasbih() {
    tasbihCount++;
    document.getElementById('tasbih-count').innerText = tasbihCount;
}

function resetTasbih() {
    tasbihCount = 0;
    document.getElementById('tasbih-count').innerText = tasbihCount;
}

// অ্যাপ চালু হলে সব ডেটা লোড করা
window.onload = () => {
    updateAlarmUI();
    fetchPrayerTimes();
    fetchSurahList();
    loadRamadan2027();
    renderDuas();
    setInterval(checkAlarmsAndDate, 10000);
};