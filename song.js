const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const lyricsContainer = $('lyrics-container');
const lyricsViewport = $('lyricsDisplay');
let allHymnsData = {};
let lines = [];
let initialHymnLines = [];
let currentIndex = 0;
let currentHymnNumber = null;
let usingCustomLyrics = false;
let currentView = 'hymn';
let audio = null;
let mainTimer = null;
let isPlaying = false;
let availableLanguages = [];
let selectedLanguages = [];
let languageOrder = [];
const SETTINGS_STORAGE_KEY = 'hymnAppSettings';
const CUSTOM_INTRO_KEY = 'hymnCustomIntros';
const DEFAULTS = {
  bgColor: '#ffffff',
  highlightColor: '#fef08a',
  transitionSpeed: '0.5',
  lyricsWidth: '800',
  languages: {
    English: { fontSize: '3', fontColor: '#111827' },
    Spanish: { fontSize: '3', fontColor: '#1e88e5' },
    ASL: { fontSize: '3', fontColor: '#d81b60' },
    Custom: { fontSize: '3', fontColor: '#111827' }
  }
};

// Prevent spacebar default behavior to avoid interference
document.addEventListener('keydown', (event) => {
  if (event.code === 'Space') {
    event.preventDefault();
  }
});

function updateAudioLanguageDisplay() {
  if (!currentHymnNumber) {
    $('audioLanguage').textContent = '';
    return;
  }
  let topLanguage = languageOrder[0] || 'English';
  if (topLanguage === 'Custom' && languageOrder.length > 1) {
    topLanguage = languageOrder[1];
  }
  topLanguage = topLanguage === 'ASL' ? 'English' : topLanguage;
  $('audioLanguage').textContent = `${topLanguage} Music`;
  if (isPlaying && audio) {
    const wasPaused = audio.paused;
    const currentTime = audio.currentTime;
    const trackType = $('trackType').checked ? 'voice' : 'accompaniment';
    const headerInfo = getHymnFileNameFromHeader(true);
    if (!headerInfo) return;
    const fileNameParts = headerInfo.fileName.split(' - ');
    const hymnNumber = fileNameParts[0];
    const newAudioPath = `audio/${topLanguage}/${trackType}/${hymnNumber}.mp3`;
    if (audio.src !== newAudioPath) {
      audio.pause();
      audio.src = newAudioPath;
      audio.currentTime = currentTime;
      audio.onloadedmetadata = async () => {
        if (!wasPaused) {
          try {
            await audio.play();
          } catch (err) {
            handlePlayError(err);
          }
        }
      };
      audio.onerror = () => {
        console.error(`Audio file not found: ${newAudioPath}. Falling back to English.`);
        $('audioLanguage').textContent = `English Music`;
        showNotice(`Warning: Audio for ${topLanguage} not found. Playing English audio instead.`);
        const englishFallbackPath = `audio/English/${trackType}/${hymnNumber}.mp3`;
        audio.src = englishFallbackPath;
        audio.currentTime = currentTime;
        audio.onloadedmetadata = async () => {
          if (!wasPaused) {
            try {
              await audio.play();
            } catch (err) {
              handlePlayError(err);
            }
          }
        };
        audio.onerror = () => {
          console.error(`English audio file not found: ${englishFallbackPath}`);
          showNotice(`Warning: English audio fallback failed. Playback stopped.`);
          stopHymn();
        };
      };
    }
  }
}

function handleDownArrow(event) {
  if (event.keyCode === 40 && $('manualControlOverride').checked && isPlaying) {
    event.preventDefault();
    if (currentIndex < (lines.length || initialHymnLines.length) - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }
}

function toggleManualControl() {
  $('metaSPL').style.display = $('manualControlOverride').checked ? 'none' : 'inline-block';
  lyricsViewport.classList.toggle('manual-active', $('manualControlOverride').checked);
  if (isPlaying && audio && !audio.paused) {
    clearTimer();
    if ($('manualControlOverride').checked) {
      $('lyricsDisplay').addEventListener('keydown', handleDownArrow);
    } else {
      $('lyricsDisplay').removeEventListener('keydown', handleDownArrow);
      const hymnEntry = allHymnsData['English'][currentHymnNumber];
      let lineTimings = [];
      let defaultSecondsPerLine = 0;
      if (hymnEntry && hymnEntry.line_timings && Array.isArray(hymnEntry.line_timings) && hymnEntry.line_timings.length > 0) {
        lineTimings = hymnEntry.line_timings.map(t => parseFloat(t) || 0.2);
      }
      if (hymnEntry && hymnEntry.line_time !== undefined && parseFloat(hymnEntry.line_time) > 0) {
        defaultSecondsPerLine = parseFloat(hymnEntry.line_time);
      } else {
        const offset = parseInt(currentHymnNumber) >= 1000 ? 3 : 5;
        const introLength = parseFloat($("introLength").value);
        defaultSecondsPerLine = (audio.duration - introLength - offset) / (hymnEntry?.lines?.length || initialHymnLines.length);
      }
      if (defaultSecondsPerLine < 0.2) defaultSecondsPerLine = 0.2;
      while (lineTimings.length < (hymnEntry?.lines?.length || initialHymnLines.length)) {
        lineTimings.push(defaultSecondsPerLine);
      }
      startAutoScroll(lineTimings);
    }
  }
}

async function loadAvailableLanguages() {
  try {
    const initialLanguages = ['English', 'Spanish', 'ASL'];
    availableLanguages = [];
    languageOrder = [];
    console.log(`Initial languages to check: ${initialLanguages.join(', ')}`);
    for (const lang of initialLanguages) {
      try {
        const res = await fetch(`data/hymns_${lang}.json`);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        allHymnsData[lang] = await res.json();
        const hasLyrics = Object.values(allHymnsData[lang]).some(hymn => hymn?.lines?.length > 0);
        if (hasLyrics) {
          availableLanguages.push(lang);
          languageOrder.push(lang);
        } else {
          console.warn(`No lyrics found for ${lang} across any hymns. Excluding from available languages.`);
          showNotice(`No lyrics found for ${lang} across any hymns. This language is excluded from selection.`);
        }
        console.log(`Loaded ${lang} with some hymns having ${hasLyrics ? 'lyrics' : 'no lyrics'}`);
      } catch (e) {
        console.warn(`Failed to load hymns_${lang}.json: ${e.message} - File may not exist or is inaccessible`);
        showNotice(`Failed to load hymns_${lang}.json for ${lang}: ${e.message}. This language is excluded.`);
      }
    }
    console.log(`Available languages: ${availableLanguages.join(', ')}`);
    if (availableLanguages.length === 0) {
      showNotice("No valid hymn data found for any language. Check data/ folder and ensure JSON files contain lyrics.");
    }
    renderLanguageList();
  } catch (error) {
    console.error("Error loading languages:", error);
    showNotice("Failed to load language files. Check data/ folder and ensure JSON files are present.");
  }
}

function renderLanguageList() {
  const langList = $('language-list');
  langList.innerHTML = '';
  const wasPlaying = isPlaying;
  const currentTime = audio ? audio.currentTime : 0;
  const wasPaused = audio ? audio.paused : true;
  languageOrder.forEach(lang => {
    let lineCount;
    if (lang === 'Custom' && usingCustomLyrics) {
      const liveCounter = $('live-line-counter');
      const customCountElement = liveCounter?.querySelector('.count-item strong');
      lineCount = customCountElement ? parseInt(customCountElement.textContent) || 0 : 0;
    } else {
      lineCount = allHymnsData[lang]?.[currentHymnNumber]?.lines?.length || 0;
    }
    const li = document.createElement('li');
    li.className = 'language-item';
    li.draggable = true;
    li.dataset.lang = lang;
    li.innerHTML = `
      <div class="checkbox-group">
        <input type="checkbox" id="lang-${lang}" ${selectedLanguages.includes(lang) ? 'checked' : ''}>
        <label for="lang-${lang}">${lang} (Line Count: ${lineCount})</label>
      </div>
    `;
    langList.appendChild(li);
  });
  langList.querySelectorAll('.language-item').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', item.dataset.lang);
    });
    item.addEventListener('dragover', (e) => e.preventDefault());
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const draggedLang = e.dataTransfer.getData('text/plain');
      const targetLang = item.dataset.lang;
      const draggedIndex = languageOrder.indexOf(draggedLang);
      const targetIndex = languageOrder.indexOf(targetLang);
      languageOrder.splice(draggedIndex, 1);
      languageOrder.splice(targetIndex, 0, draggedLang);
      renderLanguageList();
      updateLanguageSettings();
      populateLyricsContainer(lines || initialHymnLines);
      saveCurrentSettings();
      updateAudioLanguageDisplay();
    });
    item.querySelector('input').addEventListener('change', (e) => {
      const lang = item.dataset.lang;
      if (e.target.checked) {
        if (!selectedLanguages.includes(lang)) {
          selectedLanguages.push(lang);
        }
      } else {
        selectedLanguages = selectedLanguages.filter(l => l !== lang);
      }
      if (selectedLanguages.length > 3) {
        selectedLanguages.pop();
        e.target.checked = false;
      }
      if (selectedLanguages.length === 0) {
        selectedLanguages = ['English'];
        e.target.checked = true;
      }
      updateLanguageSettings();
      populateLyricsContainer(lines || initialHymnLines);
      saveCurrentSettings();
      updateAudioLanguageDisplay();
    });
  });
  updateAudioLanguageDisplay();
}

function updateLanguageSettings() {
  const langSettingsDiv = $('language-settings');
  langSettingsDiv.innerHTML = '';
  languageOrder.forEach(lang => {
    if (!selectedLanguages.includes(lang)) return;
    const div = document.createElement('div');
    div.className = 'control-group language-control-group';
    div.innerHTML = `
      <label><strong><u>${lang}</u></strong></label>
      <div class="control-row">
        <div class="control-subgroup">
          <label for="fontColor-${lang}">Font Color</label>
          <input type="color" id="fontColor-${lang}">
        </div>
        <div class="control-subgroup">
          <label for="fontSize-${lang}">Font Size: </label>
          <div class="input-group">
            <button class="btn" style="background-color: #ADD8E6; border: 1px solid #d1d5db; border-right: none; border-top-left-radius: 8px; border-bottom-left-radius: 8px; width: 2.5rem;" onclick="decreaseFontSize('${lang}')">-</button>
            <input type="number" id="fontSize-${lang}" class="form-control" min="0.1" max="20" step="0.1" value="3" style="width: 5rem; text-align: center; border-radius: 0; margin: 0; padding: 0.4rem;">
            <button class="btn" style="background-color: #ADD8E6; border: 1px solid #d1d5db; border-left: none; border-top-right-radius: 8px; border-bottom-right-radius: 8px; width: 2.5rem;" onclick="increaseFontSize('${lang}')">+</button>
          </div>
        </div>
      </div>
    `;
    langSettingsDiv.appendChild(div);
    const fontColorInput = $(`fontColor-${lang}`);
    const fontSizeInput = $(`fontSize-${lang}`);
    if (fontColorInput && fontSizeInput) {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
      if (!saved.languages?.[lang]) {
        saved.languages = saved.languages || {};
        saved.languages[lang] = saved.languages[lang] || {
          fontSize: DEFAULTS.languages[lang]?.fontSize || '3',
          fontColor: DEFAULTS.languages[lang]?.fontColor || '#111827'
        };
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(saved));
      }
      fontColorInput.value = saved.languages[lang].fontColor || DEFAULTS.languages[lang]?.fontColor || '#111827';
      fontSizeInput.value = parseFloat(saved.languages[lang].fontSize || DEFAULTS.languages[lang]?.fontSize || '3').toFixed(1);
      fontColorInput.addEventListener('input', () => {
        applySettings(getSettingsFromForm());
        saveCurrentSettings();
      });
      fontSizeInput.addEventListener('input', () => {
        let value = parseFloat(fontSizeInput.value) || 3;
        if (value < 0.1) value = 0.1;
        if (value > 20) value = 20;
        fontSizeInput.value = value.toFixed(1);
        applySettings(getSettingsFromForm());
        saveCurrentSettings();
      });
    }
  });
}

function decreaseFontSize(lang) {
  const fontSizeInput = $(`fontSize-${lang}`);
  let value = parseFloat(fontSizeInput.value) || 3;
  if (value > 0.1) {
    value -= 0.1;
    fontSizeInput.value = value.toFixed(1);
    applySettings(getSettingsFromForm());
    saveCurrentSettings();
  }
}

function increaseFontSize(lang) {
  const fontSizeInput = $(`fontSize-${lang}`);
  let value = parseFloat(fontSizeInput.value) || 3;
  if (value < 20) {
    value += 0.1;
    fontSizeInput.value = value.toFixed(1);
    applySettings(getSettingsFromForm());
    saveCurrentSettings();
  }
}

function showNotice(msg) {
  const el = $('notice');
  if (el) {
    el.style.display = msg ? "block" : "none";
    el.textContent = msg;
  }
}

function setView(viewName) {
  currentView = viewName;
  const page = document.querySelector('.page');
  const mainPanel = $('main-panel');
  const customLyricsEntry = $('custom-lyrics-entry');
  page.classList.toggle('custom-view-active', viewName === 'custom');
  mainPanel.classList.toggle('custom-view-active', viewName === 'custom');
  if (viewName === 'hymn') {
    lyricsViewport.style.display = 'block';
    customLyricsEntry.style.display = 'none';
    populateLyricsContainer(lines || initialHymnLines);
    const hasAudio = !!currentHymnNumber;
    $('trackType').disabled = !hasAudio;
    $('introLength').disabled = !hasAudio;
    if (hasAudio) {
      enablePlaybackControls(false);
    } else {
      enablePlaybackControls(false, false, true);
    }
    $('customLyricsTextarea').blur();
  } else {
    stopHymn();
    lyricsViewport.style.display = 'none';
    customLyricsEntry.style.display = 'flex';
    updateLiveCounter();
    usingCustomLyrics = true;
  }
}

function loadCustomLyrics() {
  currentIndex = 0;
  const customText = $('customLyricsTextarea').value;
  const customLines = customText.split('\n').filter(line => line.trim() !== '');
  if (customLines.length === 0) return;
  if (!usingCustomLyrics) {
    initialHymnLines = allHymnsData['English'][currentHymnNumber]?.lines || [];
  }
  lines = customLines;
  usingCustomLyrics = true;
  const liveCounter = $('live-line-counter');
  const mismatchElement = liveCounter?.querySelector('.count-mismatch');
  if (mismatchElement) {
    mismatchElement.textContent = customLines.length;
  }
  if (!availableLanguages.includes('Custom')) {
    availableLanguages.push('Custom');
    languageOrder.push('Custom');
    if (selectedLanguages.length < 3 && !selectedLanguages.includes('Custom')) {
      selectedLanguages.push('Custom');
    }
  }
  updateLiveCounter();
  renderLanguageList();
  updateLanguageSettings();
  setView('hymn');
}

function loadExcelLyrics() {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.xls,.xlsx';
  fileInput.onchange = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xls') && !file.name.toLowerCase().endsWith('.xlsx')) {
      showNotice('Please select a valid Excel file (.xls or .xlsx).');
      return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        let startProcessing = false;
        const lyricsLines = [];
        for (const row of jsonData) {
          const cells = Array.isArray(row) ? row : [];
          const validCells = cells
            .map(cell => cell != null ? String(cell).trim() : '')
            .filter(cell => cell !== '');
          const rowText = validCells.join(' ');
          if (rowText.toLowerCase().startsWith('verse 1')) {
            startProcessing = true;
            continue;
          }
          if (startProcessing && rowText !== '' && !rowText.toLowerCase().startsWith('verse ') && !rowText.toLowerCase().startsWith('chorus')) {
            lyricsLines.push(rowText);
          }
        }
        if (lyricsLines.length === 0) {
          showNotice('No valid lyrics found after "Verse 1" in the Excel file. Ensure data starts with "Verse 1".');
          return;
        }
        $('customLyricsTextarea').value = lyricsLines.join('\n');
        lines = lyricsLines;
        usingCustomLyrics = true;
        if (!availableLanguages.includes('Custom')) {
          availableLanguages.push('Custom');
          languageOrder.push('Custom');
          if (selectedLanguages.length < 3 && !selectedLanguages.includes('Custom')) {
            selectedLanguages.push('Custom');
          }
        }
        updateLiveCounter();
        renderLanguageList();
        showNotice(`Imported ${lyricsLines.length} lines from Excel.`);
      } catch (error) {
        console.error('Error parsing Excel:', error);
        showNotice('Error reading the Excel file. Please check the format.');
      }
    };
    reader.readAsArrayBuffer(file);
  };
  fileInput.click();
}

function resetLyrics() {
  if (initialHymnLines.length === 0) return;
  lines = [...initialHymnLines];
  usingCustomLyrics = false;
  const params = new URLSearchParams(location.search);
  currentHymnNumber = params.get("n");
  const title = getHymnTitleFromJSON(currentHymnNumber);
  $('pageHeader').textContent = `Hymn ${currentHymnNumber} - ${title}`;
  setView('hymn');
  loadAvailableLanguages();
}

function updateLineCountDisplay() {
  const displayEl = $('lineCountDisplay');
  if (!displayEl) return;
  const currentCount = lines.length;
  const originalCount = initialHymnLines.length;
  if (usingCustomLyrics && originalCount > 0) {
    const countsMatch = currentCount === originalCount;
    const styleClass = countsMatch ? '' : 'class="count-mismatch"';
    displayEl.innerHTML = `
      <div class="count-item">Custom: <strong ${styleClass}>${currentCount}</strong></div>
      <div class="count-item">Original: <strong>${originalCount}</strong></div>
    `;
  } else {
    displayEl.innerHTML = `<strong>${currentCount || '-'}</strong>`;
  }
}

function updateLiveCounter() {
  const displayEl = $('live-line-counter');
  const customText = $('customLyricsTextarea').value;
  const currentCount = customText === '' ? 0 : customText.split('\n').filter(line => line.trim() !== '').length;
  const originalCount = initialHymnLines.length;
  if (originalCount > 0) {
    const countsMatch = currentCount === originalCount;
    const styleClass = countsMatch ? '' : 'class="count-mismatch"';
    displayEl.innerHTML = `
      <div class="count-item">Custom: <strong ${styleClass}>${currentCount}</strong></div>
      <div class="count-item">Original: <strong>${originalCount}</strong></div>
    `;
  } else {
    displayEl.innerHTML = `<div class="count-item">Lines: <strong>${currentCount}</strong></div>`;
  }
}

function populateLyricsContainer(linesArray) {
  lyricsContainer.innerHTML = '';
  const topSpacer = document.createElement('div');
  topSpacer.className = 'spacer';
  lyricsContainer.appendChild(topSpacer);
  const displayLines = usingCustomLyrics && selectedLanguages.includes('Custom') ? lines : initialHymnLines;
  const maxLines = Math.max(displayLines.length, ...languageOrder.filter(lang => selectedLanguages.includes(lang) && lang !== 'Custom')
    .map(lang => allHymnsData[lang]?.[currentHymnNumber]?.lines?.length || 0));
  for (let index = 0; index < maxLines; index++) {
    const div = document.createElement('div');
    div.className = 'lyric-line-group';
    div.id = `line-${index}`;
    const singleLang = selectedLanguages.length === 1 ? selectedLanguages[0] : null;
    languageOrder.forEach(lang => {
      if (selectedLanguages.includes(lang)) {
        if (singleLang && lang !== singleLang) {
          return;
        }
        const p = document.createElement('p');
        p.className = `lyric-line lyric-line-${lang}`;
        if (lang === 'Custom' && usingCustomLyrics && lines[index] !== undefined) {
          p.textContent = lines[index] || '';
        } else if (lang !== 'Custom' && allHymnsData[lang]?.[currentHymnNumber]?.lines?.[index] !== undefined) {
          p.textContent = allHymnsData[lang][currentHymnNumber].lines[index] || '';
        }
        div.appendChild(p);
      }
    });
    lyricsContainer.appendChild(div);
  }
  const bottomSpacer = document.createElement('div');
  bottomSpacer.className = 'spacer';
  lyricsContainer.appendChild(bottomSpacer);
  if (usingCustomLyrics) updateLineCountDisplay();
  requestAnimationFrame(() => {
    applySettings(getSettingsFromForm());
    if (linesArray.length > 0 || initialHymnLines.length > 0) {
      setCurrentIndex(currentIndex, true);
    }
  });
}

function setCurrentIndex(newIdx, instant = false) {
  const currentLineEl = lyricsContainer.querySelector('.is-current');
  if (currentLineEl) currentLineEl.classList.remove('is-current');
  if (newIdx < 0 || newIdx >= (lines.length || initialHymnLines.length)) {
    currentIndex = -1;
    return;
  }
  const nextLineEl = $(`line-${newIdx}`);
  if (!nextLineEl) return;
  const viewportHeight = lyricsViewport.clientHeight;
  const targetScrollTop = nextLineEl.offsetTop - (viewportHeight / 2) + (nextLineEl.offsetHeight / 2);
  if (instant) {
    lyricsContainer.style.transition = 'none';
    lyricsContainer.style.transform = `translateY(-${targetScrollTop}px)`;
    setTimeout(() => {
      lyricsContainer.style.transition = `transform var(--transition-speed) ease-in-out`;
    }, 50);
  } else {
    lyricsContainer.style.transform = `translateY(-${targetScrollTop}px)`;
  }
  nextLineEl.classList.add('is-current');
  currentIndex = newIdx;
}

function formatTime(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function updateCounter() {
  if (!audio || isNaN(audio.duration)) {
    $('metaCounter').textContent = "- / -";
    return;
  }
  const currentTime = formatTime(audio.currentTime);
  const totalTime = formatTime(audio.duration);
  $('metaCounter').textContent = `${currentTime} / ${totalTime}`;
}

function startIntroCountdown(duration) {
  return new Promise(resolve => {
    const countdownEl = $('countdown-display');
    const countdownNumEl = countdownEl.querySelector('.countdown-number');
    let secondsLeft = Math.ceil(duration);
    if (duration <= 3) {
      lyricsViewport.classList.remove('is-counting-down');
      setTimeout(resolve, duration * 1000);
      return;
    }
    lyricsViewport.classList.add('is-counting-down');
    countdownEl.classList.add('is-visible');
    countdownNumEl.textContent = secondsLeft;
    clearTimer();
    mainTimer = setInterval(() => {
      secondsLeft--;
      if (secondsLeft > 0) { countdownNumEl.textContent = secondsLeft; }
      if (secondsLeft === 3) {
        countdownEl.classList.remove('is-visible');
        lyricsViewport.classList.remove('is-counting-down');
      }
      if (secondsLeft <= 0) { clearTimer(); resolve(); }
    }, 1000);
  });
}

function togglePauseResume() {
  if (isPlaying) {
    pauseHymn();
    $('btnPauseResume').innerHTML = '&#9199; Resume';
  } else {
    resumeHymn();
    $('btnPauseResume').innerHTML = '&#9208; Pause';
  }
}

function playHymn() {
  if (!currentHymnNumber) return;
  stopHymn();
  const introLength = parseFloat($("introLength").value);
  localStorage.setItem(CUSTOM_INTRO_KEY, JSON.stringify({ [currentHymnNumber]: introLength }));
  if ((lines.length === 0 && !initialHymnLines.length)) return;
  const trackType = $('trackType').checked ? 'voice' : 'accompaniment';
  let topLanguage = languageOrder[0];
  let timingLanguage = topLanguage;
  if (topLanguage === 'Custom' && languageOrder.length > 1) {
    topLanguage = languageOrder[1];
    timingLanguage = topLanguage;
  }
  topLanguage = topLanguage === 'ASL' ? 'English' : topLanguage;
  timingLanguage = timingLanguage === 'ASL' ? 'English' : timingLanguage;
  $('audioLanguage').textContent = `${topLanguage} Music`;
  const headerInfo = getHymnFileNameFromHeader(true);
  if (!headerInfo) return;
  const fileNameParts = headerInfo.fileName.split(' - ');
  const hymnNumber = fileNameParts[0];
  const fullAudioPath = `audio/${topLanguage}/${trackType}/${hymnNumber}.mp3`;
  audio = new Audio(fullAudioPath);
  audio.addEventListener('timeupdate', updateCounter);
  audio.addEventListener('ended', onAudioEnded);
  audio.onloadedmetadata = async () => {
    if (introLength >= audio.duration) return;
    updateCounter();
    const hymnEntry = allHymnsData[timingLanguage]?.[currentHymnNumber] || allHymnsData['English']?.[currentHymnNumber];
    let lineTimings = [];
    let defaultSecondsPerLine = 0;
    if (hymnEntry && hymnEntry.line_timings && Array.isArray(hymnEntry.line_timings) && hymnEntry.line_timings.length > 0) {
      lineTimings = hymnEntry.line_timings.map(t => parseFloat(t) || 0.2);
    }
    if (hymnEntry && hymnEntry.line_time !== undefined && parseFloat(hymnEntry.line_time) > 0) {
      defaultSecondsPerLine = parseFloat(hymnEntry.line_time);
    } else {
      const offset = parseInt(currentHymnNumber) >= 1000 ? 3 : 5;
      defaultSecondsPerLine = (audio.duration - introLength - offset) / (hymnEntry?.lines?.length || initialHymnLines.length);
    }
    if (defaultSecondsPerLine < 0.2) defaultSecondsPerLine = 0.2;
    while (lineTimings.length < (hymnEntry?.lines?.length || initialHymnLines.length)) {
      lineTimings.push(defaultSecondsPerLine);
    }
    const avgSecondsPerLine = lineTimings.reduce((sum, t) => sum + t, 0) / lineTimings.length;
    $('metaSPL').textContent = `Speed: ${avgSecondsPerLine.toFixed(2)}s/line`;
    setCurrentIndex(0, true);
    lyricsViewport.classList.add('intro-active');
    isPlaying = true;
    $('trackType').disabled = true;
    document.querySelectorAll('input, textarea, button').forEach(el => el.blur());
    try {
      await audio.play();
    } catch (err) {
      handlePlayError(err);
    }
    enablePlaybackControls(true);
    await startIntroCountdown(introLength);
    lyricsViewport.classList.remove('intro-active');
    if ($('manualControlOverride').checked) {
      $('lyricsDisplay').addEventListener('keydown', handleDownArrow);
    } else {
      startAutoScroll(lineTimings);
    }
  };
  audio.onerror = () => {
    console.error(`Audio file not found: ${fullAudioPath}. Falling back to second language if available.`);
    if (languageOrder.length > 1 && topLanguage !== languageOrder[1]) {
      const secondLanguage = languageOrder[1] === 'ASL' ? 'English' : languageOrder[1];
      $('audioLanguage').textContent = `${secondLanguage} Music`;
      const fallbackPath = `audio/${secondLanguage}/${trackType}/${hymnNumber}.mp3`;
      audio = new Audio(fallbackPath);
      audio.onloadedmetadata = async () => {
        showNotice(`Warning: Audio for ${topLanguage} not found. Playing ${secondLanguage} audio instead.`);
        try {
          await audio.play();
        } catch (err) {
          handlePlayError(err);
        }
      };
      audio.onerror = () => {
        console.error(`Second language audio file not found: ${fallbackPath}. Falling back to English.`);
        $('audioLanguage').textContent = `English Music`;
        showNotice(`Warning: Audio for ${secondLanguage} not found. Playing English audio instead.`);
        if (topLanguage !== 'English') {
          const englishFallbackPath = `audio/English/${trackType}/${hymnNumber}.mp3`;
          audio = new Audio(englishFallbackPath);
          audio.onloadedmetadata = async () => {
            try {
              await audio.play();
            } catch (err) {
              handlePlayError(err);
            }
          };
          audio.onerror = () => {
            console.error(`English audio file not found: ${englishFallbackPath}`);
            showNotice(`Warning: English audio fallback failed. Playback stopped.`);
            stopHymn();
          };
        } else {
          showNotice(`Warning: Audio for ${topLanguage} not found. Playback stopped.`);
          stopHymn();
        }
      };
    } else {
      $('audioLanguage').textContent = `English Music`;
      showNotice(`Warning: Audio for ${topLanguage} not found. Playing English audio instead.`);
      if (topLanguage !== 'English') {
        const englishFallbackPath = `audio/English/${trackType}/${hymnNumber}.mp3`;
        audio = new Audio(englishFallbackPath);
        audio.onloadedmetadata = async () => {
          try {
            await audio.play();
          } catch (err) {
            handlePlayError(err);
          }
        };
        audio.onerror = () => {
          console.error(`English audio file not found: ${englishFallbackPath}`);
          showNotice(`Warning: English audio fallback failed. Playback stopped.`);
          stopHymn();
        };
      } else {
        showNotice(`Warning: Audio for ${topLanguage} not found. Playback stopped.`);
        stopHymn();
      }
    }
  };
}

function startAutoScroll(lineTimings) {
  clearTimer();
  if (!isPlaying || currentIndex >= (lines.length || initialHymnLines.length)) return;
  const secondsForCurrentLine = lineTimings[currentIndex] || 0.2;
  if (isNaN(secondsForCurrentLine) || secondsForCurrentLine <= 0) return;
  mainTimer = setTimeout(() => {
    if (!isPlaying) return;
    if (currentIndex < (lines.length || initialHymnLines.length) - 1) {
      setCurrentIndex(currentIndex + 1);
      startAutoScroll(lineTimings);
    } else {
      isPlaying = false;
      clearTimer();
    }
  }, secondsForCurrentLine * 1000);
}

function stopHymn() {
  isPlaying = false;
  if (audio) { audio.pause(); audio.currentTime = 0; audio = null; }
  clearTimer();
  $('metaCounter').textContent = "- / -";
  if (!currentHymnNumber) $('audioLanguage').textContent = '';
  $('countdown-display').classList.remove('is-visible');
  lyricsViewport.classList.remove('is-counting-down', 'intro-active');
  enablePlaybackControls(false);
  $('trackType').disabled = false;
  populateLyricsContainer(lines || initialHymnLines);
  setTimeout(() => {
    setCurrentIndex(0, true);
    lyricsContainer.style.transform = 'translateY(0px)';
  }, 0);
  $('lyricsDisplay').removeEventListener('keydown', handleDownArrow);
}

function onAudioEnded() {
  isPlaying = false;
  clearTimer();
  enablePlaybackControls(false);
  $('trackType').disabled = false;
  const currentLineEl = lyricsContainer.querySelector('.is-current');
  if (currentLineEl) {
    currentLineEl.classList.remove('is-current');
  }
  $('lyricsDisplay').removeEventListener('keydown', handleDownArrow);
}

function toggleLyricOrder() {
  const lyricOrderGrid = $('lyric-order-grid');
  const lyricOrderIcon = $('lyric-order-icon');
  const isCollapsed = lyricOrderGrid.classList.toggle('is-collapsed');
  lyricOrderIcon.textContent = isCollapsed ? '▶' : '▼';
}

function toggleSettings() {
  const settingsGrid = $('settings-grid');
  const settingsIcon = $('settings-icon');
  const isCollapsed = settingsGrid.classList.toggle('is-collapsed');
  settingsIcon.textContent = isCollapsed ? '▶' : '▼';
}

function initializePage() {
  try {
    loadAvailableLanguages().then(() => {
      allHymnsData = {};
      for (const lang of availableLanguages) {
        try {
          fetch(`data/hymns_${lang}.json`).then(res => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            return res.json();
          }).then(data => {
            allHymnsData[lang] = data;
            console.log(`Loaded ${lang} with ${allHymnsData[lang][currentHymnNumber]?.lines?.length || 0} lines`);
          }).catch(err => {
            console.error(`Failed to load hymns_${lang}.json:`, err);
            showNotice(`Failed to load hymns_${lang}.json: ${err.message}`);
          });
        } catch (err) {
          console.error(`Failed to load hymns_${lang}.json:`, err);
          showNotice(`Failed to load hymns_${lang}.json: ${err.message}`);
        }
      }
      if (Object.keys(allHymnsData).length === 0) {
        showNotice("No hymn data loaded. Please check data/ folder.");
        setView('custom');
        $('pageHeader').textContent = "Error Loading Hymns";
        return;
      }
    }).catch(err => {
      console.error("Failed to load or parse hymns data:", err);
      showNotice("Error loading hymns. Please try again.");
      setView('custom');
      $('pageHeader').textContent = "Error Loading Hymns";
      return;
    });
  } catch (err) {
    console.error("Failed to load or parse hymns data:", err);
    showNotice("Error loading hymns. Please try again.");
    setView('custom');
    $('pageHeader').textContent = "Error Loading Hymns";
    return;
  }
  const params = new URLSearchParams(location.search);
  currentHymnNumber = params.get("n");
  if (!currentHymnNumber || !allHymnsData['English']?.[currentHymnNumber]) {
    showNotice("Hymn not found. Please select a valid hymn.");
    setView('custom');
    $('pageHeader').textContent = "No Hymn Selected";
    lines = [];
    initialHymnLines = [];
    return;
  }
  if (selectedLanguages.length === 0) {
    selectedLanguages = ['English'];
  }
  const liveUpdateControls = ['bgColor', 'highlightColor', 'transitionSpeed'];
  liveUpdateControls.forEach(id => {
    if ($(id)) $(id).addEventListener('input', () => { applySettings(getSettingsFromForm()); saveCurrentSettings(); });
  });
  $('applyWidthBtn').addEventListener('click', () => {
    applySettings(getSettingsFromForm());
    saveCurrentSettings();
  });
  $('trackType').addEventListener('change', () => { if (audio && !audio.paused) { switchAudioTrack(); } });
  $('resetButton').addEventListener('click', () => {
    if (confirm('Reset all settings to default?')) {
      localStorage.removeItem(SETTINGS_STORAGE_KEY);
      loadAndApplySettings();
      updateLanguageSettings();
      populateLyricsContainer(lines || initialHymnLines);
    }
  });
  $('loadCustomLyricsBtn').addEventListener('click', loadCustomLyrics);
  $('loadExcelBtn').addEventListener('click', loadExcelLyrics);
  $('customLyricsTextarea').addEventListener('input', updateLiveCounter);
  $('settings-toggle').addEventListener('click', toggleSettings);
  $('lyric-order-toggle').addEventListener('click', toggleLyricOrder);
  $('exitCustomBtn').addEventListener('click', () => setView('hymn'));
  $('manualControlOverride').addEventListener('change', toggleManualControl);
  document.querySelectorAll('button').forEach(button => {
    button.addEventListener('keydown', (event) => {
      if (event.code === 'Space') {
        event.preventDefault();
      }
    });
  });
  const entry = allHymnsData['English'][currentHymnNumber];
  initialHymnLines = entry?.lines || [];
  lines = [...initialHymnLines];
  $('pageHeader').textContent = `Hymn ${currentHymnNumber} - ${entry?.title || 'Unknown'}`;
  const savedIntros = JSON.parse(localStorage.getItem(CUSTOM_INTRO_KEY) || '{}');
  $('introLength').value = savedIntros[currentHymnNumber] || entry?.intro_length || 5;
  setView('hymn');
  loadAndApplySettings();
  updateAudioLanguageDisplay();
}

function saveCurrentSettings() {
  const settings = getSettingsFromForm();
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function getSettingsFromForm() {
  const settings = {
    bgColor: $('bgColor').value || DEFAULTS.bgColor,
    highlightColor: $('highlightColor').value || DEFAULTS.highlightColor,
    transitionSpeed: $('transitionSpeed').value || DEFAULTS.transitionSpeed,
    lyricsWidth: $('lyricsWidth').value || DEFAULTS.lyricsWidth,
    languages: {}
  };
  languageOrder.forEach(lang => {
    settings.languages[lang] = {
      fontSize: $(`fontSize-${lang}`)?.value || DEFAULTS.languages[lang]?.fontSize || '3',
      fontColor: $(`fontColor-${lang}`)?.value || DEFAULTS.languages[lang]?.fontColor || '#111827'
    };
  });
  return settings;
}

function applySettings(settings) {
  root.style.setProperty('--lyric-bg-color', settings.bgColor);
  root.style.setProperty('--lyric-highlight-color', settings.highlightColor);
  root.style.setProperty('--transition-speed', `${settings.transitionSpeed}s`);
  document.querySelector('.page').style.gridTemplateColumns = `${settings.lyricsWidth}px 400px`;
  languageOrder.forEach(lang => {
    root.style.setProperty(`--lyric-font-size-${lang}`, `${settings.languages[lang].fontSize}rem`);
    root.style.setProperty(`--lyric-font-color-${lang}`, settings.languages[lang].fontColor);
  });
  const maxFontSize = Math.max(...languageOrder.map(lang => parseFloat(settings.languages[lang].fontSize) || 3));
  const singleLineHeightRem = maxFontSize * (1.3 + 1.0);
  const viewportHeightRem = singleLineHeightRem * 3 * selectedLanguages.length;
  lyricsViewport.style.height = `${viewportHeightRem}rem`;
  const spacerHeightRem = (viewportHeightRem / 2) - (singleLineHeightRem / 2);
  document.querySelectorAll('.spacer').forEach(el => {
    el.style.height = `${spacerHeightRem < 0 ? 0 : spacerHeightRem}rem`;
  });
  setCurrentIndex(currentIndex, true);
}

function loadAndApplySettings() {
  const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
  const settings = saved ? JSON.parse(saved) : { ...DEFAULTS };
  $('bgColor').value = settings.bgColor || DEFAULTS.bgColor;
  $('highlightColor').value = settings.highlightColor || DEFAULTS.highlightColor;
  $('transitionSpeed').value = settings.transitionSpeed || DEFAULTS.transitionSpeed;
  $('lyricsWidth').value = settings.lyricsWidth || DEFAULTS.lyricsWidth;
  languageOrder.forEach(lang => {
    if ($(`fontSize-${lang}`)) $(`fontSize-${lang}`).value = settings.languages?.[lang]?.fontSize || DEFAULTS.languages[lang]?.fontSize || '3';
    if ($(`fontColor-${lang}`)) $(`fontColor-${lang}`).value = settings.languages?.[lang]?.fontColor || DEFAULTS.languages[lang]?.fontColor || '#111827';
  });
  renderLanguageList();
  updateLanguageSettings();
  applySettings(settings);
}

function enablePlaybackControls(isPlaying, isPaused = false, forceDisableAll = false) {
  $('btnPlay').disabled = forceDisableAll || isPlaying || isPaused;
  $('btnPauseResume').disabled = forceDisableAll || (!isPlaying && !isPaused);
  $('btnPauseResume').innerHTML = isPlaying ? '&#9208; Pause' : '&#9199; Resume';
  $('btnStop').disabled = forceDisableAll || (!isPlaying && !isPaused);
}

function getHymnTitleFromJSON(hymnNumber) {
  return allHymnsData['English']?.[hymnNumber]?.title || "Hymn";
}

function getHymnFileNameFromHeader(forceOriginal = false) {
  let num;
  if (forceOriginal) {
    num = currentHymnNumber;
  } else {
    const m = $('pageHeader').textContent.match(/Hymn\s+(\d+)/i);
    if (m) num = m[1];
  }
  if (num) {
    const hymnData = allHymnsData['English'][num] || {};
    const displayTitle = hymnData.title || "Hymn";
    const fileName = `${num} - ${hymnData.safe_title || displayTitle}.mp3`;
    return { fileName: fileName, number: num, title: displayTitle };
  }
  return null;
}

function handlePlayError(err) {
  console.error(`Audio play error: ${err.message}`);
  stopHymn();
}

function clearTimer() {
  if (mainTimer) {
    clearTimeout(mainTimer);
    mainTimer = null;
  }
}

function pauseHymn() {
  isPlaying = false;
  if (!audio) return;
  audio.pause();
  clearTimer();
  enablePlaybackControls(false, true);
  $('lyricsDisplay').removeEventListener('keydown', handleDownArrow);
}

function resumeHymn() {
  if (!audio) return;
  const splText = ($('metaSPL').textContent || "").split(': ')[1];
  const spl = splText ? parseFloat(splText) : 0;
  if (isNaN(spl) || spl <= 0) return;
  isPlaying = true;
  document.querySelectorAll('input, textarea, button').forEach(el => el.blur());
  try {
    audio.play();
  } catch (err) {
    handlePlayError(err);
  }
  enablePlaybackControls(true);
  const hymnEntry = allHymnsData['English'][currentHymnNumber];
  let lineTimings = [];
  if (hymnEntry && hymnEntry.line_timings && Array.isArray(hymnEntry.line_timings) && hymnEntry.line_timings.length > 0) {
    lineTimings = hymnEntry.line_timings.map(t => parseFloat(t) || 0.2);
  }
  while (lineTimings.length < (lines.length || initialHymnLines.length)) {
    lineTimings.push(spl);
  }
  if (!$('manualControlOverride').checked) {
    startAutoScroll(lineTimings);
  } else {
    $('lyricsDisplay').addEventListener('keydown', handleDownArrow);
  }
}

function switchAudioTrack() {
  const wasPlaying = isPlaying;
  const currentTime = audio ? audio.currentTime : 0;
  const trackType = $('trackType').checked ? 'voice' : 'accompaniment';
  const headerInfo = getHymnFileNameFromHeader(true);
  if (!headerInfo) return;
  const fileNameParts = headerInfo.fileName.split(' - ');
  const hymnNumber = fileNameParts[0];
  let topLanguage = languageOrder[0];
  if (topLanguage === 'Custom' && languageOrder.length > 1) {
    topLanguage = languageOrder[1];
  }
  topLanguage = topLanguage === 'ASL' ? 'English' : topLanguage;
  const newAudioPath = `audio/${topLanguage}/${trackType}/${hymnNumber}.mp3`;
  if (audio) audio.pause();
  audio = new Audio(newAudioPath);
  audio.currentTime = currentTime;
  audio.addEventListener('timeupdate', updateCounter);
  audio.addEventListener('ended', onAudioEnded);
  audio.onloadedmetadata = async () => {
    if (wasPlaying && !audio.paused) {
      try {
        await audio.play();
      } catch (err) {
        handlePlayError(err);
      }
    }
  };
  audio.onerror = () => {
    console.error(`Audio file not found: ${newAudioPath}. Falling back to English.`);
    $('audioLanguage').textContent = `English Music`;
    showNotice(`Warning: Audio for ${topLanguage} not found. Playing English audio instead.`);
    const englishFallbackPath = `audio/English/${trackType}/${hymnNumber}.mp3`;
    audio = new Audio(englishFallbackPath);
    audio.currentTime = currentTime;
    audio.onloadedmetadata = async () => {
      if (wasPlaying && !audio.paused) {
        try {
          await audio.play();
        } catch (err) {
          handlePlayError(err);
        }
      }
    };
    audio.onerror = () => {
      console.error(`English audio file not found: ${englishFallbackPath}`);
      showNotice(`Warning: English audio fallback failed. Playback stopped.`);
      stopHymn();
    };
  };
}
console.log(localStorage.getItem('hymnCustomIntros'));
document.addEventListener('DOMContentLoaded', initializePage);